import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreSessionBundles, type ResumeContext } from "./session-resume.js";
import type { ReviewContextV2, SessionBundle } from "./types.js";

/**
 * Tests for session-resume.ts.
 *
 * These lock down the two fixes for the "v2 resume: 2/7 bundles restored"
 * failure observed on PR sun-praise/latex-agent#4165:
 *
 *  1. Bootstrap must wait for `opencode serve`'s `listening on http://`
 *     line (emitted AFTER migrations commit), NOT for the `opencode.db`
 *     file to appear — SQLite creates the file before migrations finish.
 *  2. Bundles must be imported SERIALLY. Parallel `opencode import`
 *     against one SQLite DB races the non-idempotent migration DDL.
 *
 * The real `opencode` CLI is faked by a Node script on PATH. The fake
 * gates each import on a per-name release file so the test can detect
 * serial-vs-parallel execution DETERMINISTICALLY — no wall-clock timing
 * assumption. (Serve still uses a real delay; that is the documented
 * integration-test exception: fake timers cannot drive a child
 * process's own clock, and the assertion checks which branch ran, not
 * a duration.)
 */

/**
 * Install a fake `opencode` on PATH that branches on the subcommand.
 *
 * - `serve`: creates `$XDG_DATA_HOME/opencode/opencode.db` immediately
 *   (mimicking SQLite creating the file pre-migration), then — after
 *   `OAC_TEST_SERVE_DELAY_MS` — prints the listening line and stays
 *   alive until killed.
 * - `import <file>`: writes `<marker>/<base>.started`, then blocks until
 *   `<gate>/<base>.release` exists (deterministic handshake so the test
 *   controls completion order), then writes `<marker>/<base>.done` and
 *   prints the `Imported session:` contract line. If no gate dir is set
 *   the import completes immediately.
 */
function installFakeOpencode(): { binDir: string; restore: () => void } {
  const binDir = mkdtempSync(join(tmpdir(), "opencode-fake-"));
  const binPath = join(binDir, "opencode");
  const script = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const cmd = process.argv[2];
const waitFile = (p, capMs) => {
  const deadline = Date.now() + capMs;
  while (!fs.existsSync(p)) {
    if (Date.now() > deadline) { process.stderr.write("gate timeout: " + p + "\\n"); process.exit(1); }
  }
};
if (cmd === "serve") {
  // OAC_TEST_SERVE_EXIT: simulate 'opencode serve' crashing before the
  // listening line (covers the bsProc "exit" reject path).
  const exitCode = process.env.OAC_TEST_SERVE_EXIT;
  if (exitCode) { process.stderr.write("serve crashed\\n"); process.exit(Number(exitCode)); }
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) {
    fs.mkdirSync(path.join(xdg, "opencode"), { recursive: true });
    // SQLite creates the db file BEFORE migrations commit — the bug was
    // treating this file's existence as the ready signal.
    fs.writeFileSync(path.join(xdg, "opencode", "opencode.db"), "");
  }
  const delay = Number(process.env.OAC_TEST_SERVE_DELAY_MS || "0");
  setTimeout(() => {
    process.stdout.write("opencode server listening on http://127.0.0.1:0\\n");
  }, delay);
  // Stay alive like a real server until SIGTERM. unref() so the keepalive
  // timer never pins the test process exit.
  setInterval(() => {}, 1 << 30).unref();
} else if (cmd === "import") {
  const file = process.argv[3];
  // Key the marker/gate by the session id parsed from the bundle JSON
  // (info.id), NOT by the bundle file's basename — importBundle always
  // writes the bundle to "<tmpdir>/bundle.json", so basename collisions
  // would make all concurrent imports share one marker.
  let id = "unknown";
  try { id = JSON.parse(fs.readFileSync(file, "utf8")).info.id || id; } catch (e) {}
  // OAC_TEST_IMPORT_FAIL_IDS: comma-sep session ids whose import should
  // exit non-zero (covers the per-bundle try/catch isolation path).
  const failIds = (process.env.OAC_TEST_IMPORT_FAIL_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (failIds.includes(id)) { process.stderr.write("import failed for " + id + "\\n"); process.exit(1); }
  const key = id.replace(/[^A-Za-z0-9_.-]/g, "_");
  const markerDir = process.env.OAC_TEST_MARKER_DIR;
  const gateDir = process.env.OAC_TEST_IMPORT_GATE_DIR;
  if (markerDir) fs.writeFileSync(path.join(markerDir, key + ".started"), "");
  if (gateDir) waitFile(path.join(gateDir, key + ".release"), 15000);
  if (markerDir) fs.writeFileSync(path.join(markerDir, key + ".done"), "");
  process.stdout.write("Imported session: " + id + "\\n");
} else {
  process.stdout.write("{}");
}
`;
  writeFileSync(binPath, script);
  chmodSync(binPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;

  return {
    binDir,
    restore: () => {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    },
  };
}

function makeBundles(names: string[]): ReviewContextV2 {
  const bundles: SessionBundle[] = names.map((name) => ({
    name,
    sessionID: `ses_src_${name}`,
    // importBundle only writes the JSON to a temp file and passes the
    // path to the fake; the fake never reads the content, so a minimal
    // object is enough. savedAt is required by the type.
    bundle: { info: { id: `ses_src_${name}` }, messages: [] },
    savedAt: new Date().toISOString(),
  }));
  return { version: 2, repo: "owner/repo", prNumber: "123", savedAt: "now", bundles };
}

/** Bases that have a `.started` marker but not yet a `.done` marker. */
function inFlightBases(markerDir: string): string[] {
  const files = new Set(readdirSync(markerDir));
  const inFlight: string[] = [];
  for (const f of files) {
    if (!f.endsWith(".started")) continue;
    const base = f.slice(0, -".started".length);
    if (!files.has(`${base}.done`)) inFlight.push(base);
  }
  return inFlight;
}

/** Short deterministic wait for cross-process file signals. Integration-
 * test exception to fake timers: the marker files are written by a
 * separate spawned `opencode` process whose clock we cannot drive from
 * the test. 15ms is the smallest gap that reliably lets the child's
 * fs.writeFileSync flush land. */
const pollTick = (): Promise<void> => new Promise((r) => setTimeout(r, 15));

describe("session-resume", { concurrency: false }, () => {
  let savedXdg: string | undefined;
  let savedTmpdir: string | undefined;
  // Sandbox TMPDIR so importBundle's mkdtempSync(tmpdir()) lands inside a
  // per-suite dir instead of polluting the shared /tmp. Without this, the
  // oac-bundle-* dirs this suite creates (and cleans up) race the
  // opencode-bundle suite's "no oac-bundle-* in tmpdir()" assertion when
  // both run in one node --test process.
  let sandboxTmp: string | undefined;

  before(() => {
    savedXdg = process.env.XDG_DATA_HOME;
    savedTmpdir = process.env.TMPDIR;
    sandboxTmp = mkdtempSync(join(tmpdir(), "oac-resume-sandbox-"));
    process.env.TMPDIR = sandboxTmp;
  });

  after(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmpdir;
    if (sandboxTmp) rmSync(sandboxTmp, { recursive: true, force: true });
  });

  it("imports bundles SERIALLY (max in-flight == 1, not N)", async () => {
    // Regression for sun-praise/latex-agent#4165: parallel imports raced
    // migration DDL and most failed. Each fake import blocks on a
    // per-name release file, so under SERIAL execution only ONE import
    // is ever in-flight (started-but-not-done) at a time; under the old
    // PARALLEL impl all N launch at once and all are in-flight
    // simultaneously. Deterministic — no timing assumption.
    const fake = installFakeOpencode();
    const markerDir = mkdtempSync(join(tmpdir(), "oac-resume-markers-"));
    const gateDir = mkdtempSync(join(tmpdir(), "oac-resume-gate-"));
    process.env.OAC_TEST_MARKER_DIR = markerDir;
    process.env.OAC_TEST_IMPORT_GATE_DIR = gateDir;
    process.env.OAC_TEST_SERVE_DELAY_MS = "10";
    const names = ["quality", "security", "performance", "architecture"];
    let maxInFlight = 0;
    let ctx: ResumeContext | undefined;
    try {
      const promise = restoreSessionBundles(makeBundles(names), {
        baseTempDir: tmpdir(),
        prLabel: "test-serial",
      });

      // Orchestrate: repeatedly observe in-flight imports, release one,
      // wait for it to finish. Track the high-water mark of concurrent
      // in-flight imports — must be 1 (serial), never N (parallel bug).
      let released = 0;
      while (released < names.length) {
        let inflight = inFlightBases(markerDir);
        // Wait for at least one import to have started.
        let spins = 0;
        while (inflight.length === 0) {
          if (++spins > 2000) throw new Error("timed out waiting for an import to start");
          await pollTick();
          inflight = inFlightBases(markerDir);
        }
        if (inflight.length > maxInFlight) maxInFlight = inflight.length;
        // Release exactly one in-flight import.
        const target = inflight[0];
        writeFileSync(join(gateDir, `${target}.release`), "");
        released++;
        // Wait for it to finish before observing again.
        spins = 0;
        while (!existsSync(join(markerDir, `${target}.done`))) {
          if (++spins > 2000) throw new Error(`timed out waiting for ${target}.done`);
          await pollTick();
        }
      }

      ctx = await promise;

      assert.strictEqual(
        maxInFlight,
        1,
        `imports must run serially (max in-flight 1); under the parallel race this was ${names.length}. Observed max in-flight: ${maxInFlight}`,
      );
      assert.strictEqual(ctx.existingSessions.size, names.length);
      for (const name of names) {
        assert.ok(ctx.existingSessions.has(name), `missing restored session for ${name}`);
      }
    } finally {
      fake.restore();
      delete process.env.OAC_TEST_MARKER_DIR;
      delete process.env.OAC_TEST_IMPORT_GATE_DIR;
      delete process.env.OAC_TEST_SERVE_DELAY_MS;
      rmSync(markerDir, { recursive: true, force: true });
      rmSync(gateDir, { recursive: true, force: true });
      if (ctx?.tempDataHome) rmSync(ctx.tempDataHome, { recursive: true, force: true });
    }
  });

  it("bootstrap waits for the listening line, NOT for the db file to appear", async () => {
    // The fake serve creates opencode.db INSTANTLY but delays the
    // listening line beyond the bootstrap cap. A db-file poller would
    // "succeed" immediately; the listening-line waiter correctly times
    // out. Asserting the timeout warning fired proves we waited for the
    // real signal and did NOT short-circuit on the pre-migration db
    // file. Deterministic branch check, not a timing assertion.
    const fake = installFakeOpencode();
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(" ")); };
    let ctx: ResumeContext | undefined;
    try {
      process.env.OAC_TEST_SERVE_DELAY_MS = "500";
      // No IMPORT_GATE_DIR → imports run instantly via the fallback
      // path after bootstrap times out, so restore returns promptly.
      ctx = await restoreSessionBundles(makeBundles(["quality"]), {
        baseTempDir: tmpdir(),
        prLabel: "test-listening",
        bootstrapTimeoutMs: 150,
      });
      assert.ok(
        warns.some((w) => /schema bootstrap timed out after 150ms/.test(w)),
        `expected bootstrap timeout warning (proves we waited for the listening line, not the db file); got: ${warns.join(" | ")}`,
      );
      assert.ok(ctx.tempDataHome, "tempDataHome must still be returned for caller cleanup");
      // The fallback path must still have imported the single bundle —
      // without this assertion the test would pass even if imports were
      // skipped entirely after the timeout.
      assert.strictEqual(ctx.existingSessions.size, 1, "fallback import must succeed after bootstrap timeout");
    } finally {
      console.warn = origWarn;
      fake.restore();
      delete process.env.OAC_TEST_SERVE_DELAY_MS;
      if (ctx?.tempDataHome) rmSync(ctx.tempDataHome, { recursive: true, force: true });
    }
  });

  it("returns early with empty map for null / undefined / empty bundles", async () => {
    const inputs: Array<ReviewContextV2 | null | undefined> = [
      null,
      undefined,
      { version: 2, repo: "o/r", prNumber: "1", savedAt: "now", bundles: [] },
    ];
    for (const input of inputs) {
      const ctx = await restoreSessionBundles(input, { baseTempDir: tmpdir(), prLabel: "empty" });
      assert.strictEqual(ctx.existingSessions.size, 0);
      assert.strictEqual(ctx.tempDataHome, null);
    }
  });

  it("survives `opencode serve` spawn failure (missing binary) without throwing", async () => {
    // Covers the bsProc "error" reject path: a non-existent opencodeBin
    // makes spawn emit 'error'. restoreSessionBundles must NOT throw —
    // it logs a warning and falls through to (failing) imports, which
    // are themselves isolated. The result is an empty map but a real
    // tempDataHome for the caller to clean up.
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(" ")); };
    let ctx: ResumeContext | undefined;
    try {
      ctx = await restoreSessionBundles(makeBundles(["quality"]), {
        baseTempDir: tmpdir(),
        prLabel: "test-spawn-fail",
        opencodeBin: "/nonexistent/opencode-binary-that-does-not-exist",
        bootstrapTimeoutMs: 1000,
      });
      assert.ok(ctx.tempDataHome, "tempDataHome must still be returned for caller cleanup");
      assert.strictEqual(ctx.existingSessions.size, 0, "no bundle should import when serve can't start");
      assert.ok(warns.length > 0, "spawn failure must produce a warning");
    } finally {
      console.warn = origWarn;
      if (ctx?.tempDataHome) rmSync(ctx.tempDataHome, { recursive: true, force: true });
    }
  });

  it("survives `opencode serve` crashing before the listening line", async () => {
    // Covers the bsProc "exit" (non-null code) reject path. The fake
    // serve exits 1 immediately. restoreSessionBundles must warn and
    // fall through; imports are attempted via the fallback path.
    const fake = installFakeOpencode();
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(" ")); };
    let ctx: ResumeContext | undefined;
    try {
      process.env.OAC_TEST_SERVE_EXIT = "1";
      ctx = await restoreSessionBundles(makeBundles(["quality"]), {
        baseTempDir: tmpdir(),
        prLabel: "test-serve-crash",
        bootstrapTimeoutMs: 1000,
      });
      assert.ok(ctx.tempDataHome, "tempDataHome must still be returned for caller cleanup");
      assert.ok(
        warns.some((w) => /serve exited 1 before schema was ready/.test(w)),
        `expected serve-crash warning; got: ${warns.join(" | ")}`,
      );
    } finally {
      console.warn = origWarn;
      fake.restore();
      delete process.env.OAC_TEST_SERVE_EXIT;
      if (ctx?.tempDataHome) rmSync(ctx.tempDataHome, { recursive: true, force: true });
    }
  });

  it("isolates per-bundle import failures: one bad bundle doesn't block the rest", async () => {
    // Covers the per-bundle try/catch in the serial loop. 'security'
    // is configured to exit 1; the other three must still import.
    const fake = installFakeOpencode();
    let ctx: ResumeContext | undefined;
    try {
      process.env.OAC_TEST_IMPORT_FAIL_IDS = "ses_src_security";
      ctx = await restoreSessionBundles(
        makeBundles(["quality", "security", "performance"]),
        { baseTempDir: tmpdir(), prLabel: "test-partial-fail" },
      );
      assert.strictEqual(ctx.existingSessions.size, 2, "2 of 3 bundles should import despite one failure");
      assert.ok(ctx.existingSessions.has("quality"));
      assert.ok(ctx.existingSessions.has("performance"));
      assert.ok(!ctx.existingSessions.has("security"), "the failing bundle must not appear in the map");
    } finally {
      fake.restore();
      delete process.env.OAC_TEST_IMPORT_FAIL_IDS;
      if (ctx?.tempDataHome) rmSync(ctx.tempDataHome, { recursive: true, force: true });
    }
  });
});
