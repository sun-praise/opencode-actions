import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { importBundle } from "./opencode-bundle.js";
import type { ReviewContextV2 } from "./types.js";

/**
 * Result of attempting to restore previous v2 session bundles into a
 * fresh opencode DB on a (possibly different) runner.
 *
 * - `existingSessions`: name → resumed sessionID map; empty if no
 *   bundles were found, or all imports failed.
 * - `tempDataHome`: the path the caller should clean up after the run
 *   (null if no bundles were found, or if bootstrap failed).
 */
export interface ResumeContext {
  existingSessions: Map<string, string>;
  tempDataHome: string | null;
}

export interface ResumeOptions {
  /** Where to create the temp XDG_DATA_HOME (e.g. RUNNER_TEMP). */
  baseTempDir: string;
  /** Identifier used for log lines (e.g. PR number). */
  prLabel: string;
  /** Max ms to wait for `opencode.db` to materialize; default 10s. */
  bootstrapTimeoutMs?: number;
  /** Override the spawned CLI; default `opencode`. Used in tests. */
  opencodeBin?: string;
}

/**
 * Restore v2 session bundles into a fresh opencode DB. Steps:
 *
 *   1. Allocate a temp XDG_DATA_HOME so we don't pollute the runner's
 *      main `~/.local/share/opencode`.
 *   2. Bootstrap the DB schema by running `opencode serve` and waiting
 *      for its `listening on http://` ready line (emitted AFTER all
 *      migrations commit). Polling for `opencode.db` alone is unsafe —
 *      SQLite creates the file before migrations finish.
 *   3. Import each bundle SERIALLY. Parallel imports race the
 *      non-idempotent migration DDL against the same SQLite DB; one
 *      bad bundle still doesn't block the rest (per-bundle try/catch).
 *
 * On any failure, returns an empty map and null tempDataHome — the
 * caller should fall back to the "no resume, fresh start" path.
 *
 * SIDE EFFECT: sets `process.env.XDG_DATA_HOME` to the temp dir for the
 * remainder of the process lifetime. Any subsequent `opencode` calls in
 * the same process (including the SDK `createOpencode` that follows in
 * index.ts) will read/write from this temp dir, which is exactly what we
 * want — but be aware that other unrelated `opencode` invocations
 * elsewhere in the same process will also be redirected. Callers should
 * `delete process.env.XDG_DATA_HOME` if they need to revert.
 */
export async function restoreSessionBundles(
  reviewBundles: ReviewContextV2 | null | undefined,
  options: ResumeOptions,
): Promise<ResumeContext> {
  const empty: ResumeContext = { existingSessions: new Map(), tempDataHome: null };
  if (!reviewBundles || reviewBundles.bundles.length === 0) return empty;

  const tempDataHome = join(options.baseTempDir, `oac-resume-${options.prLabel}-${randomUUID()}`);
  mkdirSync(tempDataHome, { recursive: true });
  process.env.XDG_DATA_HOME = tempDataHome;
  console.log(`v2 resume: using temp XDG_DATA_HOME=${tempDataHome}`);

  // Bootstrap the DB schema. `opencode import` requires a FULLY-migrated
  // schema before it can write session rows. The authoritative "schema
  // ready" signal is the `opencode server listening on http://...` line
  // that `opencode serve` prints AFTER all migrations commit. Polling
  // for the `opencode.db` file alone is insufficient — SQLite creates
  // the file before migrations finish, so a file-exists check can leave
  // us with a half-migrated schema. When the `opencode import` calls
  // then race the non-idempotent migration DDL (`ALTER TABLE … ADD`,
  // `CREATE INDEX`, `INSERT INTO migration`), most fail with
  // "index/column/migration row already exists" — observed in the wild
  // as `v2 resume: 2/7 bundles restored` and empty reviewer output.
  const dbPath = join(tempDataHome, "opencode", "opencode.db");
  const bin = options.opencodeBin ?? "opencode";
  const bsProc = spawn(bin, ["serve", "--port", "0"], {
    env: { ...process.env, XDG_DATA_HOME: tempDataHome },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Single promise resolved by the listening line, rejected on spawn
  // error, premature exit, or timeout. Promise.withResolvers keeps one
  // resolver wired across multiple event handlers without callback
  // nesting; later resolve/reject calls on the settled promise are
  // no-ops, so every handler can call them unconditionally.
  const { promise: readyPromise, resolve: readyResolve, reject: readyReject } =
    Promise.withResolvers<void>();
  let serveOutput = "";
  const onServeData = (chunk: Buffer | string): void => {
    serveOutput += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (/listening on https?:\/\//i.test(serveOutput)) {
      readyResolve();
    }
  };
  bsProc.stdout?.on("data", onServeData);
  bsProc.stderr?.on("data", onServeData);
  bsProc.on("error", (err) => readyReject(err));
  bsProc.on("exit", (code) => {
    if (code !== null) {
      readyReject(new Error(
        `opencode serve exited ${code} before schema was ready${
          serveOutput ? `: ${serveOutput.trim().slice(0, 500)}` : ""
        }`,
      ));
    }
  });

  // AbortController guarantees `opencode serve` is killed even if we
  // exit early (timeout, or a thrown import later on). Without it a
  // leaked serve could pin the temp XDG_DATA_HOME and block the
  // finally cleanup in the caller.
  const bootstrapAbort = new AbortController();
  const killBootstrap = () => {
    if (!bsProc.killed) bsProc.kill("SIGTERM");
  };
  bootstrapAbort.signal.addEventListener("abort", killBootstrap);

  const bootstrapTimeoutMs = options.bootstrapTimeoutMs ?? 10_000;
  const bootstrapStartedAt = Date.now();
  const timer = setTimeout(
    () => readyReject(new Error(`schema bootstrap timed out after ${bootstrapTimeoutMs}ms`)),
    bootstrapTimeoutMs,
  );

  try {
    await readyPromise;
    console.log(`v2 resume: schema bootstrapped in ${Date.now() - bootstrapStartedAt}ms`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const haveDb = existsSync(dbPath) ? "db file exists" : "no db file";
    // Best-effort fallback for opencode versions that don't emit the
    // listening line: if the db file at least exists, try the imports
    // anyway — per-bundle failures are isolated below.
    console.warn(`v2 resume: ${reason} (${haveDb}); bundles may fail to import`);
  } finally {
    clearTimeout(timer);
    bootstrapAbort.abort();
  }

  // Import bundles SERIALLY. Even with a fully-migrated schema above,
  // parallel `opencode import` against the same SQLite DB can race on
  // WAL write locks and re-trigger migration DDL if any import detects
  // a stale schema version. Serializing costs a few seconds but makes
  // the restore deterministic. Per-bundle failures are still isolated.
  const existingSessions = new Map<string, string>();
  for (const b of reviewBundles.bundles) {
    try {
      const importedId = await importBundle(b.bundle, {
        ...process.env,
        XDG_DATA_HOME: tempDataHome,
      });
      existingSessions.set(b.name, importedId);
      console.log(`v2 resume: imported bundle for "${b.name}" → ${importedId}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`v2 resume: failed to import bundle: ${reason}`);
    }
  }
  console.log(`v2 resume: ${existingSessions.size}/${reviewBundles.bundles.length} bundles restored`);
  return { existingSessions, tempDataHome };
}