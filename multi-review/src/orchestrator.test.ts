import { describe, it } from "node:test";
import assert from "node:assert";
import {
  runParallelReviewers,
  runCoordinator,
  cleanupAllSessions,
} from "./orchestrator.js";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { Reviewer } from "./types.js";

/**
 * In-memory fake of the parts of OpencodeClient that orchestrator.ts
 * touches. Each reviewer gets its own session so we can assert which
 * sessionID was used for prompt() (the resume path).
 *
 * Captures every call so tests can make assertions about the orchestrator
 * resume behavior (existingSessions → skip create) without hitting a
 * real opencode server.
 */

interface FakeClientOptions {
  /** Map of sessionID → messages to return from messages(). */
  messagesBySession?: Map<string, Array<any>>;
  /** If set, session.create() always returns this id. Otherwise a UUID-ish id. */
  defaultSessionID?: string;
}

interface FakeCallRecord {
  method: string;
  args: any;
}

function createFakeClient(opts: FakeClientOptions = {}): {
  client: OpencodeClient;
  calls: FakeCallRecord[];
  createdSessions: string[];
  deletedSessions: string[];
} {
  const calls: FakeCallRecord[] = [];
  const createdSessions: string[] = [];
  const deletedSessions: string[] = [];
  let counter = 0;

  const makeSessionID = () => opts.defaultSessionID ?? `ses_${++counter}`;

  const client = {
    session: {
      async create(_args: any) {
        calls.push({ method: "session.create", args: _args });
        const id = makeSessionID();
        createdSessions.push(id);
        return { data: { id } } as any;
      },
      async prompt(args: any) {
        calls.push({ method: "session.prompt", args });
        // Echo the path id as the resulting "info" so cost=undefined, tokens=undefined.
        return { data: { info: undefined } } as any;
      },
      async messages(args: any) {
        calls.push({ method: "session.messages", args });
        const id = args.path?.id ?? "";
        const messages = opts.messagesBySession?.get(id) ?? [
          {
            info: { role: "assistant" },
            parts: [{ type: "text", text: `output from ${id}` }],
          },
        ];
        return { data: messages } as any;
      },
      async delete(args: any) {
        calls.push({ method: "session.delete", args });
        deletedSessions.push(args.path?.id);
        return { data: undefined } as any;
      },
      async get(_args: any) {
        calls.push({ method: "session.get", args: _args });
        return { data: {} } as any;
      },
      async fork(_args: any) {
        calls.push({ method: "session.fork", args: _args });
        return { data: { id: makeSessionID() } } as any;
      },
    },
    // The orchestrator only touches session.*, so other endpoints are stubs.
    event: { async list() { return { data: [] } as any; } },
  } as unknown as OpencodeClient;

  return { client, calls, createdSessions, deletedSessions };
}

const reviewers: Reviewer[] = [
  { name: "quality", prompt: "be strict" },
  { name: "security", prompt: "find vulns" },
];

describe("orchestrator: runParallelReviewers", { concurrency: false }, () => {
  it("creates a new session per reviewer when existingSessions is empty", async () => {
    const { client, calls, createdSessions, deletedSessions } = createFakeClient();
    const existingSessions = new Map<string, string>();

    const results = await runParallelReviewers(client, reviewers, "diff text", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      existingSessions,
    });

    assert.strictEqual(results.length, 2);
    assert.ok(results.every((r) => r.success));
    assert.strictEqual(createdSessions.length, 2);
    // Each result carries its own sessionID
    assert.strictEqual(typeof results[0].sessionID, "string");
    assert.strictEqual(typeof results[1].sessionID, "string");
    assert.notStrictEqual(results[0].sessionID, results[1].sessionID);
    // cleanup ran on the default (skipSessionCleanup=false)
    assert.strictEqual(deletedSessions.length, 2);
    // session.prompt was called with the new sessionID for each reviewer
    const promptCalls = calls.filter((c) => c.method === "session.prompt");
    assert.strictEqual(promptCalls.length, 2);
    for (const r of results) {
      assert.ok(
        promptCalls.some((c) => c.args.path?.id === r.sessionID),
        `expected a session.prompt for sessionID ${r.sessionID}`,
      );
    }
  });

  it("resumes existing sessions when existingSessions map provides them", async () => {
    const { client, calls, createdSessions, deletedSessions } = createFakeClient();
    const existingSessions = new Map<string, string>([
      ["quality", "ses_existing_q"],
      ["security", "ses_existing_s"],
    ]);

    const results = await runParallelReviewers(client, reviewers, "diff text", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      existingSessions,
    });

    assert.ok(results.every((r) => r.success));
    // No new sessions created — we resumed the existing ones.
    assert.strictEqual(createdSessions.length, 0);
    // Cleanup still ran (skipSessionCleanup default = false).
    assert.deepStrictEqual(deletedSessions.sort(), ["ses_existing_q", "ses_existing_s"]);
    // session.prompt was called with the existing sessionIDs, not new ones.
    const promptCalls = calls.filter((c) => c.method === "session.prompt");
    assert.strictEqual(promptCalls.length, 2);
    const promptedIDs = promptCalls.map((c) => c.args.path?.id).sort();
    assert.deepStrictEqual(promptedIDs, ["ses_existing_q", "ses_existing_s"]);
    // Result sessionIDs reflect the resumed session.
    assert.strictEqual(results[0].sessionID, "ses_existing_q");
    assert.strictEqual(results[1].sessionID, "ses_existing_s");
  });

  it("partially resumes: only reviewers in the map get resumed, others create new", async () => {
    const { client, createdSessions, deletedSessions } = createFakeClient();
    const existingSessions = new Map<string, string>([
      ["quality", "ses_resumed_q"],
    ]);
    // 'security' is missing from the map → falls back to create+prompt.

    const results = await runParallelReviewers(client, reviewers, "diff text", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      existingSessions,
    });

    assert.ok(results.every((r) => r.success));
    // One new session for the missing reviewer.
    assert.strictEqual(createdSessions.length, 1);
    // Both sessions got cleaned up.
    assert.strictEqual(deletedSessions.length, 2);

    const quality = results.find((r) => r.reviewer === "quality")!;
    const security = results.find((r) => r.reviewer === "security")!;
    assert.strictEqual(quality.sessionID, "ses_resumed_q");
    assert.notStrictEqual(security.sessionID, "ses_resumed_q");
  });

  it("skipSessionCleanup=true keeps the session row for export", async () => {
    const { client, deletedSessions, createdSessions } = createFakeClient();
    const existingSessions = new Map<string, string>();

    await runParallelReviewers(client, reviewers, "diff text", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      existingSessions,
      skipSessionCleanup: true,
    });

    // No deletions — caller is responsible for cleanupAllSessions or
    // opencode export.
    assert.strictEqual(deletedSessions.length, 0);
    assert.strictEqual(createdSessions.length, 2);
  });

  it("skipSessionCleanup=true but resume path also keeps the row", async () => {
    const { client, deletedSessions, createdSessions } = createFakeClient();
    const existingSessions = new Map<string, string>([
      ["quality", "ses_keep_q"],
      ["security", "ses_keep_s"],
    ]);

    await runParallelReviewers(client, reviewers, "diff text", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      existingSessions,
      skipSessionCleanup: true,
    });

    // No new sessions, no deletions.
    assert.strictEqual(createdSessions.length, 0);
    assert.strictEqual(deletedSessions.length, 0);
  });

  it("captures sessionID on the failure path too", async () => {
    // Make session.prompt throw on a specific session so we can verify
    // the result still surfaces sessionID.
    const client = {
      session: {
        async create(_args: any) { return { data: { id: "ses_fail" } } as any; },
        async prompt(_args: any) { throw new Error("LLM down"); },
        async messages(_args: any) { return { data: [] } as any; },
        async delete(_args: any) { return { data: undefined } as any; },
        async get(_args: any) { return { data: {} } as any; },
        async fork(_args: any) { return { data: { id: "ses_x" } } as any; },
      },
      event: { async list() { return { data: [] } as any; } },
    } as unknown as OpencodeClient;

    const results = await runParallelReviewers(client, [{ name: "quality", prompt: "p" }], "diff", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);
    assert.ok(results[0].error?.includes("LLM down"));
    assert.strictEqual(results[0].sessionID, "ses_fail");
  });

  it("cleanupAllSessions deletes sessions tracked when skipSessionCleanup=true", async () => {
    const { client, createdSessions, deletedSessions } = createFakeClient();
    // skipSessionCleanup: true keeps sessions tracked in the module-level
    // activeSessions set so the caller can clean them up later via
    // cleanupAllSessions (or via opencode export + manual cleanup).
    await runParallelReviewers(client, reviewers, "diff", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      skipSessionCleanup: true,
    });
    assert.strictEqual(createdSessions.length, 2);
    assert.strictEqual(deletedSessions.length, 0, "skipSessionCleanup should skip deletion");

    const myIds = new Set(createdSessions);
    await cleanupAllSessions(client);
    // Both sessions we created via runParallelReviewers must be in the
    // deleted set now. (We don't assert "exactly 2 new deletes" because
    // the module-level activeSessions set is shared across tests in the
    // suite and earlier tests may have left entries that also got
    // cleaned up — that's fine, the contract is "everything tracked is
    // deleted" which earlier tests already cover in the default path.)
    for (const id of myIds) {
      assert.ok(
        deletedSessions.includes(id),
        `expected ${id} to be deleted by cleanupAllSessions`,
      );
    }
  });

  it("cleanupAllSessions is idempotent (calling twice does not throw)", async () => {
    const { client } = createFakeClient();
    await cleanupAllSessions(client);
    await cleanupAllSessions(client);
  });

  it("retries transient fetch failures on a fresh session, then succeeds", async () => {
    // session.prompt throws "fetch failed" on the first call only.
    let promptCalls = 0;
    const createdSessions: string[] = [];
    const deletedSessions: string[] = [];
    let counter = 0;
    const client = {
      session: {
        async create(_args: any) {
          const id = `ses_${++counter}`;
          createdSessions.push(id);
          return { data: { id } } as any;
        },
        async prompt(args: any) {
          promptCalls++;
          if (promptCalls === 1) {
            throw new Error("fetch failed");
          }
          return { data: { info: undefined } } as any;
        },
        async messages(args: any) {
          const id = args.path?.id ?? "";
          return {
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: `ok ${id}` }] }],
          } as any;
        },
        async delete(args: any) {
          deletedSessions.push(args.path?.id);
          return { data: undefined } as any;
        },
        async get(_args: any) { return { data: {} } as any; },
        async fork(_args: any) { return { data: { id: "ses_x" } } as any; },
      },
      event: { async list() { return { data: [] } as any; } },
    } as unknown as OpencodeClient;

    const results = await runParallelReviewers(client, [{ name: "quality", prompt: "p" }], "diff", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      retryBackoffMs: 0, // skip the wait in tests
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, true);
    assert.ok(results[0].content?.includes("ok "), `expected recovered content, got: ${results[0].content}`);
    // Two sessions created (first failed, second succeeded).
    assert.strictEqual(createdSessions.length, 2);
    // The failed first session was torn down; the successful second one
    // was cleaned up too (skipSessionCleanup default false).
    assert.deepStrictEqual(deletedSessions.sort(), createdSessions.slice().sort());
    // Result sessionID is the session that actually produced the review.
    assert.strictEqual(results[0].sessionID, createdSessions[1]);
  });

  it("gives up after REVIEWER_MAX_ATTEMPTS persistent transient failures", async () => {
    const createdSessions: string[] = [];
    const deletedSessions: string[] = [];
    let counter = 0;
    const client = {
      session: {
        async create(_args: any) {
          const id = `ses_${++counter}`;
          createdSessions.push(id);
          return { data: { id } } as any;
        },
        async prompt(_args: any) { throw new Error("fetch failed"); },
        async messages(_args: any) { return { data: [] } as any; },
        async delete(args: any) {
          deletedSessions.push(args.path?.id);
          return { data: undefined } as any;
        },
        async get(_args: any) { return { data: {} } as any; },
        async fork(_args: any) { return { data: { id: "ses_x" } } as any; },
      },
      event: { async list() { return { data: [] } as any; } },
    } as unknown as OpencodeClient;

    const results = await runParallelReviewers(client, [{ name: "quality", prompt: "p" }], "diff", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      retryBackoffMs: 0,
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);
    assert.ok(results[0].error?.includes("fetch failed"));
    // 3 attempts → 3 sessions created, all torn down.
    assert.strictEqual(createdSessions.length, 3);
    assert.deepStrictEqual(deletedSessions.sort(), createdSessions.slice().sort());
  });

  it("does not retry non-transient errors (e.g. model-side failure)", async () => {
    const createdSessions: string[] = [];
    let counter = 0;
    const client = {
      session: {
        async create(_args: any) {
          const id = `ses_${++counter}`;
          createdSessions.push(id);
          return { data: { id } } as any;
        },
        async prompt(_args: any) { throw new Error("context length exceeded"); },
        async messages(_args: any) { return { data: [] } as any; },
        async delete(_args: any) { return { data: undefined } as any; },
        async get(_args: any) { return { data: {} } as any; },
        async fork(_args: any) { return { data: { id: "ses_x" } } as any; },
      },
      event: { async list() { return { data: [] } as any; } },
    } as unknown as OpencodeClient;

    const results = await runParallelReviewers(client, [{ name: "quality", prompt: "p" }], "diff", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      retryBackoffMs: 0,
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);
    assert.ok(results[0].error?.includes("context length exceeded"));
    // Non-transient → exactly one attempt, one session.
    assert.strictEqual(createdSessions.length, 1);
  });

  it("resumes existing session, then on a transient failure drops it and retries on a fresh session (v2 export path)", async () => {
    // Mirrors index.ts: existingSessions + skipSessionCleanup=true (the
    // willExportSessions path). First attempt resumes ses_resumed and
    // hits `fetch failed`; catch must delete that resumed session, then
    // retry must create a brand-new session that succeeds and survives
    // (skipSessionCleanup keeps it for export).
    const createdSessions: string[] = [];
    const deletedSessions: string[] = [];
    let counter = 0;
    let promptCalls = 0;
    const client = {
      session: {
        async create(_args: any) {
          const id = `ses_new_${++counter}`;
          createdSessions.push(id);
          return { data: { id } } as any;
        },
        async prompt(args: any) {
          promptCalls++;
          if (promptCalls === 1) {
            throw new Error("fetch failed");
          }
          return { data: { info: undefined } } as any;
        },
        async messages(args: any) {
          return {
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: `ok ${args.path?.id}` }] }],
          } as any;
        },
        async delete(args: any) {
          deletedSessions.push(args.path?.id);
          return { data: undefined } as any;
        },
        async get(_args: any) { return { data: {} } as any; },
        async fork(_args: any) { return { data: { id: "ses_x" } } as any; },
      },
      event: { async list() { return { data: [] } as any; } },
    } as unknown as OpencodeClient;

    const results = await runParallelReviewers(client, [{ name: "quality", prompt: "p" }], "diff", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      existingSessions: new Map([["quality", "ses_resumed"]]),
      skipSessionCleanup: true,
      retryBackoffMs: 0,
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, true);
    // The resumed session was torn down on the failed first attempt…
    assert.ok(deletedSessions.includes("ses_resumed"), "resumed session must be deleted on transient failure");
    // …and exactly one fresh session was created for the retry.
    assert.strictEqual(createdSessions.length, 1);
    // The surviving sessionID is the fresh one, not the resumed one.
    assert.strictEqual(results[0].sessionID, createdSessions[0]);
    assert.notStrictEqual(results[0].sessionID, "ses_resumed");
    // skipSessionCleanup kept the successful fresh session alive.
    assert.ok(!deletedSessions.includes(createdSessions[0]), "fresh session must survive (skipSessionCleanup)");
  });

  it("tears down the session on a non-transient failure even under skipSessionCleanup (contract change)", async () => {
    // The pre-retry `finally` was gated on !skipSessionCleanup; now a
    // failed attempt always deletes. A resumed reviewer that dies on a
    // permanent error must not leak its (half-run) session.
    const createdSessions: string[] = [];
    const deletedSessions: string[] = [];
    const client = {
      session: {
        async create(_args: any) {
          const id = `ses_${createdSessions.length + 1}`;
          createdSessions.push(id);
          return { data: { id } } as any;
        },
        async prompt(_args: any) { throw new Error("context length exceeded"); },
        async messages(_args: any) { return { data: [] } as any; },
        async delete(args: any) {
          deletedSessions.push(args.path?.id);
          return { data: undefined } as any;
        },
        async get(_args: any) { return { data: {} } as any; },
        async fork(_args: any) { return { data: { id: "ses_x" } } as any; },
      },
      event: { async list() { return { data: [] } as any; } },
    } as unknown as OpencodeClient;

    const results = await runParallelReviewers(client, [{ name: "quality", prompt: "p" }], "diff", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      existingSessions: new Map([["quality", "ses_resumed"]]),
      skipSessionCleanup: true,
      retryBackoffMs: 0,
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);
    assert.ok(results[0].error?.includes("context length exceeded"));
    // Non-transient → exactly one attempt; resumed session was torn down.
    assert.strictEqual(createdSessions.length, 0);
    assert.ok(deletedSessions.includes("ses_resumed"), "resumed session must be torn down on non-transient failure");
  });

  it("does not retry the reviewer's own deadline timeout", async () => {
    // isTransientReviewerError must exclude our withTimeout deadline
    // message ("X timed out after Nms"). Retrying an expired global
    // budget is pointless. This guards the regex against accidental
    // edits that would make deadline timeouts retriable.
    const createdSessions: string[] = [];
    let counter = 0;
    const client = {
      session: {
        async create(_args: any) {
          const id = `ses_${++counter}`;
          createdSessions.push(id);
          return { data: { id } } as any;
        },
        async prompt(_args: any) { throw new Error("quality timed out after 60000ms"); },
        async messages(_args: any) { return { data: [] } as any; },
        async delete(_args: any) { return { data: undefined } as any; },
        async get(_args: any) { return { data: {} } as any; },
        async fork(_args: any) { return { data: { id: "ses_x" } } as any; },
      },
      event: { async list() { return { data: [] } as any; } },
    } as unknown as OpencodeClient;

    const results = await runParallelReviewers(client, [{ name: "quality", prompt: "p" }], "diff", {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      retryBackoffMs: 0,
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);
    assert.ok(results[0].error?.includes("timed out after 60000ms"));
    // Deadline timeout is NOT transient → exactly one attempt.
    assert.strictEqual(createdSessions.length, 1);
  });
});

describe("orchestrator: runCoordinator", { concurrency: false }, () => {
  const reviews = [
    { reviewer: "quality", content: "ok", success: true, messages: [] },
    { reviewer: "security", content: "warn", success: true, messages: [] },
  ] as any;

  it("creates a new session when no existing one is provided", async () => {
    const { client, createdSessions, deletedSessions } = createFakeClient();
    const result = await runCoordinator(client, reviews, {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
    });
    assert.strictEqual(createdSessions.length, 1);
    assert.ok(result.sessionID);
    assert.strictEqual(deletedSessions.length, 1);
  });

  it("resumes existing session when existingSessions has 'coordinator'", async () => {
    const { client, createdSessions, deletedSessions } = createFakeClient();
    const result = await runCoordinator(client, reviews, {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      existingSessions: new Map([["coordinator", "ses_coord_existing"]]),
    });
    assert.strictEqual(createdSessions.length, 0);
    assert.strictEqual(result.sessionID, "ses_coord_existing");
    assert.strictEqual(deletedSessions.length, 1);
    assert.strictEqual(deletedSessions[0], "ses_coord_existing");
  });

  it("skipSessionCleanup=true keeps coordinator session for export", async () => {
    const { client, createdSessions, deletedSessions } = createFakeClient();
    await runCoordinator(client, reviews, {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      skipSessionCleanup: true,
    });
    assert.strictEqual(createdSessions.length, 1);
    assert.strictEqual(deletedSessions.length, 0);
  });

  it("content extraction joins assistant text parts", async () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "ignored" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "first part" },
          { type: "tool", name: "read" },
          { type: "text", text: "second part" },
        ],
      },
    ];
    const { client } = createFakeClient({
      messagesBySession: new Map([["ses_coord", messages]]),
    });
    const result = await runCoordinator(client, reviews, {
      globalTimeoutMs: 60_000,
      coordinatorTimeoutMs: 30_000,
      coordinatorPrompt: "",
      existingSessions: new Map([["coordinator", "ses_coord"]]),
    });
    assert.strictEqual(result.content, "first part\nsecond part");
  });
});