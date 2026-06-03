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

// Shared hash-number avoidance instruction appended to all reviewer prompts.
// Content is loaded from shared-prompts/ at runtime.
const HASH_AVOID_FILE = { zh: "hash-avoid-zh.txt", en: "hash-avoid-en.txt" };

function loadHashAvoid(actionPath: string): { zh: string; en: string } {
  const dir = join(actionPath, "shared-prompts");
  const zh = readFileSync(join(dir, HASH_AVOID_FILE.zh), "utf-8").trim();
  const en = readFileSync(join(dir, HASH_AVOID_FILE.en), "utf-8").trim();
  return { zh: "\n" + zh, en: "\n" + en };
}

function buildLangInstruction(language: string, hashAvoid: { zh: string; en: string }): string {
  if (language === "en") {
    return (
      "\n\nIMPORTANT: Respond entirely in English. " +
      "Use English for all analysis, explanations, and output. " +
      "For any verdict keywords listed in the prompt, use their English equivalents." +
      hashAvoid.en
    );
  }
  return (
    "\n\n请使用中文回复。所有分析和说明均使用中文。" +
    "对于 prompt 中列出的判定关键词，使用其中文版本。" +
    hashAvoid.zh
  );
}

export function loadReviewers(opts: {
  actionPath: string;
  team?: string;
}): Reviewer[] {
  const builtInDir = join(opts.actionPath, "reviewers");
  const personas = loadBuiltInReviewers(builtInDir);

  const teamStr = opts.team || env("MULTI_REVIEW_DEFAULT_TEAM") || DEFAULT_TEAM;
  const team = parseTeam(teamStr);

  const hashAvoid = loadHashAvoid(opts.actionPath);
  const language = (env("MULTI_REVIEW_LANGUAGE") || "zh").trim().toLowerCase();
  const langInstruction = buildLangInstruction(language, hashAvoid);

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
        prompt: persona.prompt + langInstruction,
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
