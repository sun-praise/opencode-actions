import { createOpencode } from "@opencode-ai/sdk/v2";

process.env.XDG_DATA_HOME = "/tmp/oac-resume-poc";

console.log("Starting opencode on temp DB (already has injected session)...");
const port = 4700 + Math.floor(Math.random() * 100);
console.log(`Port: ${port}`);

// Wrap fetch to log outgoing requests
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (req: any, init?: any) => {
  const url = typeof req === "string" ? req : req.url;
  console.log(`[FETCH] ${req.method ?? init?.method ?? "GET"} ${url}`);
  console.log(`  headers:`, init?.headers ?? (req?.headers ? Object.fromEntries(req.headers) : "(none)"));
  const res = await realFetch(req, init);
  console.log(`[FETCH] -> ${res.status}`);
  return res;
};

const { client, server } = await createOpencode({
  config: { agent: { permission: { edit: "deny", bash: "deny" } } } as any,
  port,
  timeout: 30000,
});
console.log("Started");
const SID = process.argv[2];
console.log(`Querying session: ${SID}`);
const got = await client.session.get({ sessionID: SID!, throwOnError: false });
console.log("Result:", JSON.stringify(got, null, 2).slice(0, 2000));
await server.close();