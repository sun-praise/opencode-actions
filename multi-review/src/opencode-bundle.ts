/**
 * Helpers around `opencode export` / `opencode import` CLI.
 *
 * These wrap the built-in opencode session serialization so we can
 * move a session across runners without re-implementing the row
 * schema ourselves. The flow is:
 *
 *   source runner  →  opencode export <sessionID>  →  JSON bundle
 *   cache server   ←  PUT /context/.../v2
 *   target runner  →  GET /context/.../v2 → JSON bundle
 *                  →  opencode import <file>        (inject into local DB)
 *                  →  client.session.prompt(existingSessionID, newDiff)
 *                       ↑ LLM SDK reads prior context from local DB rows
 *
 * The bundle is the raw stdout of `opencode export` — it contains the
 * session row, all messages, and all parts in one JSON object. Bundles
 * can be a few MB for a long-running review session, so the caller is
 * responsible for keeping only the per-persona bundles it cares about
 * (not the entire opencode history).
 */

import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run `opencode <args>` with the supplied env, capture stdout, throw on
 * non-zero exit. The wrapper exists because (a) we always want UTF-8 text,
 * (b) errors from the CLI are usually on stderr but the body shape on
 * stdout matters too.
 */
function runOpencode(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("opencode", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c.toString("utf8")));
    proc.stderr.on("data", (c) => (err += c.toString("utf8")));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve(out);
      // Include BOTH streams: opencode prints progress ("Exporting
      // session: ...") to stderr but the actual failure reason often
      // lands on stdout. Truncate so a huge partial bundle doesn't
      // blow up the log / a thrown error.
      const dump = (s: string) => s.trim().slice(0, 2000);
      reject(new Error(`opencode ${args.join(" ")} exited ${code}\n[stderr] ${dump(err)}\n[stdout] ${dump(out)}`));
    });
  });
}

/**
 * Export a session from the local opencode DB to a JSON bundle. Returns
 * the parsed JSON (the same shape `opencode export` writes to a file).
 *
 * `env` is forwarded as-is — caller is responsible for setting
 * `XDG_DATA_HOME` etc. so the right DB is targeted.
 *
 * NB: stdout is redirected to a temp FILE, not captured through a Node
 * pipe. `opencode export` of a long session is multi-MB, and when its
 * stdout is a pipe the CLI exits 0 after writing only ~the pipe-buffer
 * worth of data (a buffered-writer + os.Exit flush bug on the opencode
 * side), truncating the JSON. Redirecting to a regular file (the same
 * code path as `opencode export > file`) reliably yields the full
 * output. See docs/journal/2026-06-25-session-resume-design.md.
 */
export async function exportSession(
  sessionID: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const tmpDir = mkdtempSync(join(tmpdir(), "oac-export-"));
  const file = join(tmpDir, "export.json");
  try {
    await new Promise<void>((resolve, reject) => {
      // fd is the child's stdout — a regular file, not a pipe.
      const fd = openSync(file, "w");
      let err = "";
      const proc = spawn("opencode", ["export", sessionID], {
        env,
        stdio: ["ignore", fd, "pipe"],
      });
      proc.stderr.on("data", (c) => (err += c.toString("utf8")));
      const done = (fn: () => void) => {
        try { closeSync(fd); } catch { /* already closed */ }
        fn();
      };
      proc.on("error", (e) => done(() => reject(e)));
      proc.on("exit", (code) => {
        if (code === 0) done(() => resolve());
        else done(() => reject(new Error(`opencode export ${sessionID} exited ${code}: ${err.trim().slice(0, 2000)}`)));
      });
    });
    const raw = readFileSync(file, "utf8");
    return JSON.parse(raw);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Import a bundle (the parsed JSON from `opencode export`) into the
 * local opencode DB. The bundle is first written to a temp file because
 * `opencode import` reads from a path. Returns the new sessionID (which
 * is the same as the source's sessionID by default — that's how opencode
 * preserves continuity).
 */
export async function importBundle(
  bundle: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const tmpDir = mkdtempSync(join(tmpdir(), "oac-bundle-"));
  const file = join(tmpDir, "bundle.json");
  try {
    writeFileSync(file, JSON.stringify(bundle));
    const out = await runOpencode(["import", file], env);
    // CLI prints: "Imported session: ses_xxx"
    const m = out.match(/Imported session:\s*(\S+)/);
    if (!m) {
      throw new Error(`opencode import did not return session id: ${out.trim()}`);
    }
    return m[1];
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * For a one-off synchronous read of a bundle file (e.g. a pre-fetched
 * bundle in tests). Throws if the file doesn't exist.
 */
export function readBundleFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}
