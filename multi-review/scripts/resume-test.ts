/**
 * Proof-of-concept: can opencode resume a session from rows injected
 * into a fresh DB?
 *
 * Flow:
 *   1. Start opencode in a fresh XDG_DATA_HOME (so it creates an empty
 *      opencode.db with the right schema).
 *   2. Stop server, grab DB path.
 *   3. Bootstrap: start opencode briefly, create a session, send a fake
 *      user message (via direct INSERT into message/part tables), stop.
 *      Verify rows exist.
 *   4. Save bundle snapshot (session + messages + parts) to a JSON file.
 *   5. Wipe DB.
 *   6. Bootstrap schema again (start opencode briefly).
 *   7. Inject bundle rows from snapshot.
 *   8. Start opencode, verify session.get / messages / prompt all work.
 *
 * If step 8 succeeds, the cross-runner resume idea is viable: bundle
 * serialization + restore = session continuity without text-blob cache.
 */

import { createOpencode } from "@opencode-ai/sdk/v2";

// Wrap fetch to log every request/response
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (req: any, init?: any) => {
  const url = typeof req === "string" ? req : req.url;
  console.log(`[FETCH] ${req.method ?? init?.method ?? "GET"} ${url}`);
  const res = await realFetch(req, init);
  console.log(`[FETCH] -> ${res.status}`);
  return res;
};
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEMP_XDG = "/tmp/oac-resume-poc";
const DB_PATH = join(TEMP_XDG, "opencode", "opencode.db");

function reset(): void {
  if (existsSync(TEMP_XDG)) rmSync(TEMP_XDG, { recursive: true, force: true });
  mkdirSync(TEMP_XDG, { recursive: true });
}

function snapshotRows(dbPath: string, sessionID: string): unknown {
  const db = new Database(dbPath, { readonly: true });
  try {
    const session = db.prepare("SELECT * FROM session WHERE id = ?").get(sessionID);
    const messages = db.prepare("SELECT * FROM message WHERE session_id = ? ORDER BY time_created").all(sessionID);
    const parts = db.prepare("SELECT * FROM part WHERE session_id = ? ORDER BY time_created").all(sessionID);
    const project = (session as any)?.project_id
      ? db.prepare("SELECT * FROM project WHERE id = ?").get((session as any).project_id)
      : null;
    return { session, project, messages, parts };
  } finally {
    db.close();
  }
}

function injectRows(dbPath: string, bundle: any): void {
  const db = new Database(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    if (bundle.project) {
      const cols = Object.keys(bundle.project);
      const placeholders = cols.map(c => `?`).join(", ");
      db.prepare(`INSERT OR REPLACE INTO project (${cols.join(", ")}) VALUES (${placeholders})`).run(...cols.map(c => (bundle.project as any)[c]));
    }
    if (bundle.session) {
      const cols = Object.keys(bundle.session);
      const placeholders = cols.map(c => `?`).join(", ");
      db.prepare(`INSERT OR REPLACE INTO session (${cols.join(", ")}) VALUES (${placeholders})`).run(...cols.map(c => (bundle.session as any)[c]));
    }
    for (const m of bundle.messages) {
      const cols = Object.keys(m);
      const placeholders = cols.map(c => `?`).join(", ");
      db.prepare(`INSERT OR REPLACE INTO message (${cols.join(", ")}) VALUES (${placeholders})`).run(...cols.map(c => m[c]));
    }
    for (const p of bundle.parts) {
      const cols = Object.keys(p);
      const placeholders = cols.map(c => `?`).join(", ");
      db.prepare(`INSERT OR REPLACE INTO part (${cols.join(", ")}) VALUES (${placeholders})`).run(...cols.map(c => p[c]));
    }
  } finally {
    db.close();
  }
}

async function bootstrapSchema(): Promise<void> {
  process.env.XDG_DATA_HOME = TEMP_XDG;
  // Use a known port so we can run opencode manually with captured stderr
  process.env.OPENCODE_PORT = "5099";
  const { client, server } = await createOpencode({
    config: { agent: { permission: { edit: "deny", bash: "deny" } } } as any,
    port: 5099,
    timeout: 15000,
  });
  await client.session.list({ throwOnError: true });
  await server.close();
}

async function main() {
  console.log("=== Phase 1: bootstrap schema in fresh XDG_DATA_HOME ===");
  reset();
  await bootstrapSchema();
  console.log(`Schema created at ${DB_PATH}`);
  console.log(`Exists? ${existsSync(DB_PATH)}`);

  console.log("\n=== Phase 2: create session with messages ===");
  process.env.XDG_DATA_HOME = TEMP_XDG;
  let serverHandle: any;
  let client: any;
  let sessionID: string;
  {
    const { client: c, server } = await createOpencode({
      config: { agent: { permission: { edit: "deny", bash: "deny" } } } as any,
      port: 5099,
      timeout: 15000,
    });
    client = c;
    serverHandle = server;
    const created = await client.session.create({ throwOnError: true });
    sessionID = created.data.id;
    console.log(`Created session: ${sessionID}`);
    // Insert 2 realistic fake messages (use schema from real opencode messages)
    const db = new Database(DB_PATH);
    db.exec("PRAGMA foreign_keys = ON");
    const ts = Date.now();
    const userMsgID = `msg_${ts.toString(36)}u1`;
    const asstMsgID = `msg_${ts.toString(36)}a1`;
    const userPartID = `prt_${ts.toString(36)}u1`;
    const asstPartID = `prt_${ts.toString(36)}a1`;
    const modelInfo = { providerID: "test-provider", modelID: "test-model" };
    const userMsgData = {
      role: "user",
      time: { created: ts },
      agent: "build",
      model: modelInfo,
      summary: { diffs: [] },
    };
    const asstMsgData = {
      parentID: userMsgID,
      role: "assistant",
      mode: "build",
      agent: "build",
      path: { cwd: process.cwd(), root: process.cwd() },
      cost: 0,
      tokens: { total: 50, input: 30, output: 20, reasoning: 0, cache: { write: 0, read: 0 } },
      modelID: modelInfo.modelID,
      providerID: modelInfo.providerID,
      time: { created: ts + 1, completed: ts + 2 },
      finish: "stop",
    };
    db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(userMsgID, sessionID, ts, ts, JSON.stringify(userMsgData));
    db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(asstMsgID, sessionID, ts + 1, ts + 1, JSON.stringify(asstMsgData));
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(userPartID, userMsgID, sessionID, ts, ts, JSON.stringify({ type: "text", text: "Please review PR #1" }));
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(asstPartID, asstMsgID, sessionID, ts + 1, ts + 1, JSON.stringify({ type: "text", text: "PR #1 review: looks good." }));
    db.close();
    console.log("Inserted 2 realistic messages + 2 parts");
    await server.close();
  }

  console.log("\n=== Phase 3: snapshot bundle ===");
  const bundle = snapshotRows(DB_PATH, sessionID);
  console.log(`session: ${(bundle as any).session?.id}`);
  console.log(`messages: ${(bundle as any).messages.length}`);
  console.log(`parts: ${(bundle as any).parts.length}`);
  console.log(`project: ${(bundle as any).project?.id ?? "(none)"}`);

  console.log("\n=== Phase 4: wipe DB, re-bootstrap schema ===");
  rmSync(DB_PATH, { force: true });
  // Also wipe WAL/SHM if any
  rmSync(DB_PATH + "-wal", { force: true });
  rmSync(DB_PATH + "-shm", { force: true });
  await bootstrapSchema();
  console.log(`Re-bootstrapped at ${DB_PATH}`);

  console.log("\n=== Phase 5: inject bundle rows ===");
  injectRows(DB_PATH, bundle);
  console.log("Injected");
  {
    const db = new Database(DB_PATH, { readonly: true });
    const s = db.prepare("SELECT id, title FROM session WHERE id = ?").get(sessionID);
    const m = db.prepare("SELECT COUNT(*) as c FROM message WHERE session_id = ?").get(sessionID);
    const p = db.prepare("SELECT COUNT(*) as c FROM part WHERE session_id = ?").get(sessionID);
    console.log(`Verify in DB: session=${JSON.stringify(s)}, messages=${(m as any).c}, parts=${(p as any).c}`);
    db.close();
  }

  console.log("\n=== Phase 6: restart opencode, verify resume ===");
  {
    const { client: c, server } = await createOpencode({
      config: { agent: { permission: { edit: "deny", bash: "deny" } } } as any,
      port: 5099,
      timeout: 15000,
    });
    client = c;
    const got = await client.session.get({ sessionID, throwOnError: false });
    console.log(`session.get response: ${JSON.stringify(got, null, 2)}`);
    if (got.error) {
      console.log(`session.get error: ${JSON.stringify(got.error, null, 2)}`);
      return;
    }
    console.log(`session.get: ${got.data.id} title="${got.data.title}"`);

    const msgs = await client.session.messages({ sessionID, throwOnError: false });
    console.log(`session.messages response: ${JSON.stringify(msgs, null, 2).slice(0, 2000)}`);

    const parts = await client.session.message({ sessionID, messageID: (msgs.data ?? [])[0]?.id, throwOnError: true }).catch(() => null);
    console.log(`first message parts count: ${(parts as any)?.data?.length ?? "(couldn't fetch)"}`);

    console.log("\n=== Phase 7: v1 prompt() — directly with sessionID in arg ===");
    // v1 prompt: /session/{sessionID}/message. Pass sessionID + parts at top level
    // (buildClientParams has a bug with { path, body } wrapping, so use flat shape)
    const promptResp = await client.session.prompt({
      sessionID,
      agent: "build",
      parts: [{ type: "text", text: "What did you say about PR #1?" } as any],
      throwOnError: false,
    } as any).catch((e: any) => ({ error: String(e) }));
    console.log(`v1 prompt response: ${JSON.stringify(promptResp, null, 2).slice(0, 1000)}`);

    console.log("\n=== Phase 8: verify new message persisted ===");
    const msgsAfter = await client.session.messages({ sessionID, throwOnError: false });
    console.log(`messages after prompt: ${JSON.stringify(msgsAfter, null, 2).slice(0, 3000)}`);

    await server.close();
  }
}

main()
  .then(() => {
    console.log("\n=== POC complete ===");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });