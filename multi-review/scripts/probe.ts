import { createOpencode } from "@opencode-ai/sdk";
console.log("BEFORE createOpencode");
const { client, server } = await createOpencode({ timeout: 30000 });
console.log("AFTER createOpencode");
const list = await client.session.list({ throwOnError: true });
console.log(`OK: ${list.data?.length ?? 0} sessions`);
await server.close();
console.log("DONE");