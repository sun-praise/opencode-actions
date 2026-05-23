import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Reviewer } from "./types.js";

interface PersonaYAML {
  name: string;
  prompt: string;
}

const DEFAULT_TEAM = "quality:1,security:1,performance:1,architecture:1";

function parseTeam(teamStr: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const entry of teamStr.split(",")) {
    const [name, count] = entry.trim().split(":");
    if (name) result.set(name.trim(), Math.max(1, parseInt(count || "1", 10) || 1));
  }
  return result;
}

function loadBuiltInReviewers(reviewersDir: string): Map<string, PersonaYAML> {
  const map = new Map<string, PersonaYAML>();
  for (const file of ["quality.yaml", "security.yaml", "performance.yaml", "architecture.yaml"]) {
    try {
      const raw = readFileSync(join(reviewersDir, file), "utf-8");
      const parsed = parseYAML(raw);
      if (parsed.name && parsed.prompt) map.set(parsed.name, { name: parsed.name, prompt: parsed.prompt });
    } catch { /* skip missing files */ }
  }
  return map;
}

function parseYAML(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  let currentKey = "";
  let inPrompt = false;
  for (const line of raw.split("\n")) {
    if (!inPrompt && line.match(/^(\w+):\s*(.*)/)) {
      const [, key, value] = line.match(/^(\w+):\s*(.*)/) || [];
      if (key === "prompt" && value.trim().startsWith("|")) {
        inPrompt = true;
        currentKey = "prompt";
        result.prompt = "";
      } else if (key) {
        result[key] = value?.trim() || "";
      }
    } else if (inPrompt) {
      if (line && !line.startsWith(" ") && !line.startsWith("\t")) {
        inPrompt = false;
      } else {
        result[currentKey] = (result[currentKey] || "") + line.trimStart() + "\n";
      }
    }
  }
  if (result.prompt) result.prompt = result.prompt.trim();
  return result;
}

export function loadReviewers(opts: {
  actionPath: string;
  team?: string;
  configPath?: string;
}): Reviewer[] {
  const builtInDir = join(opts.actionPath, "reviewers");
  const personas = loadBuiltInReviewers(builtInDir);

  const teamStr = opts.team || env("MULTI_REVIEW_DEFAULT_TEAM") || DEFAULT_TEAM;
  const team = parseTeam(teamStr);

  const reviewers: Reviewer[] = [];
  for (const [name, count] of team) {
    const persona = personas.get(name);
    if (!persona) {
      console.warn(`Warning: unknown reviewer persona "${name}", skipping`);
      continue;
    }
    for (let i = 0; i < count; i++) {
      reviewers.push({
        name: count > 1 ? `${name}-${i + 1}` : name,
        prompt: persona.prompt,
      });
    }
  }

  return reviewers;
}

export function env(key: string): string {
  return process.env[key] || "";
}

export function intEnv(key: string, fallback: number): number {
  const v = parseInt(process.env[key] || "", 10);
  return isNaN(v) ? fallback : v;
}

export function resolveModel(): { providerID: string; modelID: string } {
  const raw = env("MULTI_REVIEW_MODEL") || env("MODEL_NAME") || "zhipuai-coding-plan/glm-5.1";
  const idx = raw.indexOf("/");
  if (idx === -1) return { providerID: "", modelID: raw };
  return { providerID: raw.slice(0, idx), modelID: raw.slice(idx + 1) };
}
