import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  clean: true,
  noExternal: ["@opencode-ai/sdk"],
  external: ["child_process", "fs", "path"],
});
