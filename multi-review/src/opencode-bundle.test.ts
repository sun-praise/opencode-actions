import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exportSession, importBundle, readBundleFile } from "./opencode-bundle.js";

/**
 * Tests for opencode-bundle.ts.
 *
 * The real `opencode export` / `opencode import` CLI is exercised only in
 * the cross-runner e2e smoke (see docs/journal/2026-06-25-session-resume-design.md).
 * Here we instead install a tiny fake `opencode` binary on PATH that
 * simulates the CLI — sufficient to lock down:
 *  - argument forwarding
 *  - env forwarding (XDG_DATA_HOME etc.)
 *  - stdout/stderr handling
 *  - exit-code error path
 *  - the "Imported session: <id>" stdout contract
 *
 * The fake doesn't write to any opencode DB — that's the real CLI's job
 * and is covered by the e2e smoke.
 */

interface FakeOpencodeScript {
  body: string;
  /** If set, the fake prints this to stdout after the body runs. */
  appendStdout?: string;
}

function installFakeOpencode(script: FakeOpencodeScript): { binDir: string; restore: () => void } {
  const binDir = mkdtempSync(join(tmpdir(), "opencode-fake-"));
  const binPath = join(binDir, "opencode");
  // POSIX sh script. Uses $1, $2 for argv and prints marker line that
  // the importBundle regex consumes.
  const shebang = "#!/usr/bin/env bash\nset -e\n";
  writeFileSync(binPath, shebang + script.body);
  chmodSync(binPath, 0o755);

  const original = process.env.PATH;
  process.env.PATH = `${binDir}:${original ?? ""}`;

  return {
    binDir,
    restore: () => {
      process.env.PATH = original;
      rmSync(binDir, { recursive: true, force: true });
    },
  };
}

describe("opencode-bundle", { concurrency: false }, () => {
  describe("exportSession", () => {
    it("spawns `opencode export <sessionID>` and parses stdout JSON", async () => {
      const fake = installFakeOpencode({
        body: `echo '{"info":{"id":"ses_abc"},"messages":[]}'`,
      });
      try {
        const bundle = await exportSession("ses_abc");
        assert.deepStrictEqual(bundle, { info: { id: "ses_abc" }, messages: [] });
      } finally {
        fake.restore();
      }
    });

    it("forwards XDG_DATA_HOME from env", async () => {
      // The fake writes a fixed JSON envelope that includes the XDG_DATA_HOME
      // it sees. We use a single-quoted heredoc style by writing the
      // script via set -e + printf to avoid bash quoting hazards.
      const fake = installFakeOpencode({
        body: `printf '%s' '{"xdg":"'"\$XDG_DATA_HOME"'"}'`,
      });
      try {
        const bundle = (await exportSession("ses_x", {
          ...process.env,
          XDG_DATA_HOME: "/tmp/oac-test-xdg",
        })) as { xdg: string };
        assert.strictEqual(bundle.xdg, "/tmp/oac-test-xdg");
      } finally {
        fake.restore();
      }
    });

    it("rejects when the CLI exits non-zero", async () => {
      const fake = installFakeOpencode({
        body: `echo "session not found" 1>&2\nexit 2`,
      });
      try {
        await assert.rejects(
          () => exportSession("ses_missing"),
          /exited 2.*session not found/s,
        );
      } finally {
        fake.restore();
      }
    });
  });

  describe("importBundle", () => {
    it("writes the bundle to a temp file and parses the session id from stdout", async () => {
      // The fake reads the bundle file (argv[2] since argv[0] is the
      // binary name and argv[1] is the subcommand `import`) and prints
      // both the file content + the contract marker.
      const fake = installFakeOpencode({
        body: `cat "$2"\necho ""\necho "Imported session: ses_imported_42"`,
      });
      try {
        const sid = await importBundle({ info: { id: "x" }, messages: [{ hello: "world" }] });
        assert.strictEqual(sid, "ses_imported_42");
      } finally {
        fake.restore();
      }
    });

    it("rejects when stdout does not contain the 'Imported session:' marker", async () => {
      const fake = installFakeOpencode({
        body: `echo "no marker here"`,
      });
      try {
        await assert.rejects(
          () => importBundle({}),
          /opencode import did not return session id/,
        );
      } finally {
        fake.restore();
      }
    });

    it("rejects when the CLI exits non-zero", async () => {
      const fake = installFakeOpencode({
        body: `echo "corrupt bundle" 1>&2\nexit 3`,
      });
      try {
        await assert.rejects(
          () => importBundle({}),
          /exited 3.*corrupt bundle/s,
        );
      } finally {
        fake.restore();
      }
    });

    it("cleans up the temp bundle directory on success", async () => {
      // The fake CLI writes the path of the bundle file it was handed
      // (argv[2]) into a marker file the test can read. After importBundle
      // resolves, that file must be gone — which proves the temp dir was
      // removed (it's the only thing in there).
      const markerDir = mkdtempSync(join(tmpdir(), "oac-bundle-marker-"));
      const markerPath = join(markerDir, "bundle-path.txt");
      const fake = installFakeOpencode({
        body: `echo "$2" > "${markerPath}"\necho "Imported session: ses_ok"`,
      });
      try {
        await importBundle({ info: { id: "x" } });
        const recorded = readFileSync(markerPath, "utf-8").trim();
        assert.ok(
          recorded.endsWith("bundle.json"),
          `fake should have been invoked with the bundle path; got '${recorded}'`,
        );
        assert.strictEqual(
          existsSync(recorded),
          false,
          `temp bundle file should have been removed after success; still exists at ${recorded}`,
        );
        assert.strictEqual(
          existsSync(dirname(recorded)),
          false,
          `temp bundle directory should have been removed after success; still exists at ${dirname(recorded)}`,
        );
      } finally {
        rmSync(markerDir, { recursive: true, force: true });
        fake.restore();
      }
    });

    it("cleans up the temp bundle directory on failure", async () => {
      // Same approach as the success-cleanup test, but the fake exits
      // non-zero before writing the marker. After the rejection, the
      // temp bundle file the fake would have read must still be gone.
      // We can't record the path through the CLI here, so instead we
      // assert via a different channel: list /tmp entries matching
      // oac-bundle-* — there must be ZERO of them.
      const fake = installFakeOpencode({
        body: `exit 99`,
      });
      try {
        await assert.rejects(() => importBundle({}));
        const leak = readdirSync(tmpdir()).filter((n) => n.startsWith("oac-bundle-"));
        assert.deepStrictEqual(
          leak,
          [],
          `no oac-bundle-* temp dirs should remain after importBundle rejection; found: ${leak.join(", ")}`,
        );
      } finally {
        fake.restore();
      }
    });
  });

  describe("readBundleFile", () => {
    it("reads and parses a JSON bundle file", () => {
      const tmp = mkdtempSync(join(tmpdir(), "bundle-read-"));
      const file = join(tmp, "b.json");
      writeFileSync(file, JSON.stringify({ info: { id: "ses_q" }, messages: [] }));
      try {
        const bundle = readBundleFile(file) as { info: { id: string } };
        assert.strictEqual(bundle.info.id, "ses_q");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("throws when the file content is invalid JSON", () => {
      const tmp = mkdtempSync(join(tmpdir(), "bundle-read-bad-"));
      const file = join(tmp, "b.json");
      writeFileSync(file, "not json {");
      try {
        assert.throws(() => readBundleFile(file), SyntaxError);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("throws when the file does not exist", () => {
      assert.throws(() => readBundleFile("/tmp/does-not-exist-bundle.json"));
    });
  });
});