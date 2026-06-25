import { createOpencode } from "@opencode-ai/sdk/v2";

process.env.XDG_DATA_HOME = "/tmp/oac-resume-poc";

const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (req: any, init?: any) => {
  const url = typeof req === "string" ? req : req.url;
  console.log(`[FETCH] ${req.method ?? init?.method ?? "GET"} ${url}`);
  const res = await realFetch(req, init);
  console.log(`[FETCH] -> ${res.status}`);
  const body = await res.text();
  console.log(`[FETCH] body: ${body.slice(0, 2000)}`);
  return new Response(body, { status: res.status, headers: res.headers });
};

const port = 5099;
const { client, server } = await createOpencode({
  config: { agent: { permission: { edit: "deny", bash: "deny" } } } as any,
  port,
  timeout: 30000,
});
const SID = process.argv[2];
console.log(`Querying messages for: ${SID}`);
const r = await client.session.messages({ sessionID: SID!, throwOnError: false });
console.log("messages:", JSON.stringify(r, null, 2).slice(0, 3000));
await server.close();