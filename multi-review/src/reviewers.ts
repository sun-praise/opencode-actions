import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
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
      const parsed = yaml.load(raw) as PersonaYAML;
      if (parsed.name && parsed.prompt) map.set(parsed.name, { name: parsed.name, prompt: parsed.prompt });
    } catch { /* skip missing files */ }
  }
  return map;
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
  if (idx === -1) {
    throw new Error(`Model "${raw}" missing provider (expected format: provider/model)`);
  }
  return { providerID: raw.slice(0, idx), modelID: raw.slice(idx + 1) };
}
