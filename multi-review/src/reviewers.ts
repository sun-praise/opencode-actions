import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { Reviewer } from "./types.js";

interface PersonaYAML {
  name: string;
  prompt: string;
}

const DEFAULT_TEAM = "quality:1,security:1,performance:1,architecture:1,regression-test:1,test-value:1";

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
  for (const file of ["quality.yaml", "security.yaml", "performance.yaml", "architecture.yaml", "regression-test.yaml", "test-value.yaml", "spec-coverage.yaml"]) {
    try {
      const raw = readFileSync(join(reviewersDir, file), "utf-8");
      const parsed = yaml.load(raw) as PersonaYAML;
      if (parsed.name && parsed.prompt) map.set(parsed.name, { name: parsed.name, prompt: parsed.prompt });
    } catch { /* skip missing files */ }
  }
  return map;
}

const CUSTOM_REVIEWERS_DIR = ".github/reviewers";

/**
 * Load custom reviewer personas from the target repo's .github/reviewers/ directory.
 * Custom personas with the same name as a built-in override the built-in.
 * Returns the map of loaded custom personas (does NOT mutate the built-in map).
 */
function loadCustomReviewers(repoDir: string): Map<string, PersonaYAML> {
  const map = new Map<string, PersonaYAML>();
  const dir = join(repoDir, CUSTOM_REVIEWERS_DIR);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return map; // directory does not exist — opt-in, skip silently
  }
  for (const file of entries) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      const parsed = yaml.load(raw) as PersonaYAML;
      if (parsed.name && parsed.prompt) {
        map.set(parsed.name, { name: parsed.name, prompt: parsed.prompt });
      } else {
        console.warn(`Warning: custom reviewer "${file}" missing required fields (name, prompt), skipping`);
      }
    } catch (e) {
      console.warn(`Warning: failed to load custom reviewer "${file}": ${e}`);
    }
  }
  return map;
}

// Hash-number avoidance instruction appended to all reviewer prompts.
// Loaded from shared/prompts/ at runtime (the single source of truth shared
// with github-run-opencode via the action checkout layout: actionPath/../shared/prompts/).
const HASH_AVOID_FILE = { zh: "hash-avoid-zh.txt", en: "hash-avoid-en.txt" };

type HashAvoidBundle = { zh: string; en: string };

function loadHashAvoid(actionPath: string): HashAvoidBundle {
  if (!actionPath) {
    throw new Error("loadHashAvoid: actionPath is empty (GITHUB_ACTION_PATH is unset)");
  }
  const dir = join(actionPath, "..", "shared", "prompts");
  try {
    const zh = readFileSync(join(dir, HASH_AVOID_FILE.zh), "utf-8").trim();
    const en = readFileSync(join(dir, HASH_AVOID_FILE.en), "utf-8").trim();
    return { zh: "\n" + zh, en: "\n" + en };
  } catch (e) {
    console.error(`loadHashAvoid: failed to read hash-avoid prompts (see debug log for path)`);
    throw new Error(
      `hash-avoid prompt files missing; ensure shared/prompts/ is bundled with the action`,
    );
  }
}

function buildLangInstruction(language: string, hashAvoid: HashAvoidBundle): string {
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
  repoDir?: string;
}): Reviewer[] {
  const builtInDir = join(opts.actionPath, "reviewers");
  const personas = loadBuiltInReviewers(builtInDir);

  // Merge custom personas from target repo — overrides built-in on name collision
  const repoDir = opts.repoDir || process.cwd();
  const custom = loadCustomReviewers(repoDir);
  for (const [name, persona] of custom) {
    if (personas.has(name)) {
      console.log(`Custom reviewer "${name}" overrides built-in persona`);
    }
    personas.set(name, persona);
  }

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
