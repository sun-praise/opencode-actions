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
 *   2. Bootstrap the DB schema by running `opencode serve` and polling
 *      for the materialized `opencode.db` file.
 *   3. Import each bundle in parallel — one bad bundle shouldn't
 *      prevent the rest from being restored.
 *   4. Return the resolved name→sessionID map for the orchestrator.
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

  // Bootstrap the DB schema by running `opencode serve` and waiting for
  // `opencode.db` to materialize on disk. The `opencode import` CLI
  // requires the schema to exist before it can write session rows.
  // We poll instead of using a fixed 3s timeout — on a cold runner the
  // migration can take >1s, and on a warm cache it's instant. A safety
  // cap protects against a wedged `opencode` binary.
  const dbPath = join(tempDataHome, "opencode", "opencode.db");
  const bin = options.opencodeBin ?? "opencode";
  const bsProc = spawn(bin, ["serve", "--port", "0"], {
    env: { ...process.env, XDG_DATA_HOME: tempDataHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bsProc.on("error", (err) => {
    console.warn(`v2 resume: opencode serve spawn failed: ${err.message}`);
  });
  // AbortController to guarantee `opencode serve` is killed even if
  // the function exits before reaching the SIGTERM below (e.g. the
  // outer flow throws during bundle import). Without this, a leaked
  // `opencode serve` could pin the temp XDG_DATA_HOME and block the
  // cleanup in the finally block.
  const bootstrapAbort = new AbortController();
  const killBootstrap = () => {
    if (!bsProc.killed) bsProc.kill("SIGTERM");
  };
  bootstrapAbort.signal.addEventListener("abort", killBootstrap);

  const bootstrapTimeoutMs = options.bootstrapTimeoutMs ?? 10_000;
  const bootstrapStartedAt = Date.now();
  const bootstrapDeadline = bootstrapStartedAt + bootstrapTimeoutMs;
  while (Date.now() < bootstrapDeadline) {
    if (existsSync(dbPath)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  bootstrapAbort.abort();
  if (!existsSync(dbPath)) {
    console.warn(`v2 resume: schema bootstrap timed out after ${bootstrapTimeoutMs}ms; bundles may fail to import`);
  } else {
    console.log(`v2 resume: schema bootstrapped in ${Date.now() - bootstrapStartedAt}ms`);
  }

  // Import each bundle in parallel. Per-bundle failures are isolated —
  // one bad bundle should not prevent the rest from restoring.
  const importResults = await Promise.allSettled(
    reviewBundles.bundles.map(async (b) => {
      const importedId = await importBundle(b.bundle, {
        ...process.env,
        XDG_DATA_HOME: tempDataHome,
      });
      return { name: b.name, sessionID: importedId };
    }),
  );
  const existingSessions = new Map<string, string>();
  for (const r of importResults) {
    if (r.status === "fulfilled") {
      existingSessions.set(r.value.name, r.value.sessionID);
      console.log(`v2 resume: imported bundle for "${r.value.name}" → ${r.value.sessionID}`);
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(`v2 resume: failed to import bundle: ${reason}`);
    }
  }
  console.log(`v2 resume: ${existingSessions.size}/${reviewBundles.bundles.length} bundles restored`);
  return { existingSessions, tempDataHome };
}