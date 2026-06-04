import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadReviewers } from "./reviewers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// multi-review action root (one level up from src/)
const ACTION_PATH = resolve(HERE, "..");
// shared/prompts/ relative to ACTION_PATH
const SHARED_PROMPTS = join(ACTION_PATH, "..", "shared", "prompts");

describe("loadReviewers hash-avoid loading", () => {
  const originalEnv = { ...process.env };

  before(() => {
    // Use a minimal team so loadReviewers does not iterate over every persona.
    process.env.MULTI_REVIEW_DEFAULT_TEAM = "quality:1";
    process.env.MULTI_REVIEW_LANGUAGE = "zh";
  });

  after(() => {
    process.env = { ...originalEnv };
  });

  it("loads hash-avoid prompts from shared/prompts/ (not multi-review/prompts/)", () => {
    // Sanity: confirm the file layout we are testing against.
    // The legacy multi-review/prompts/ copy must NOT exist anymore.
    assert.equal(
      false,
      existsSync(join(ACTION_PATH, "prompts")),
      "legacy multi-review/prompts/ should be removed",
    );
    // The shared canonical file must exist.
    assert.equal(true, existsSync(SHARED_PROMPTS), "shared/prompts/ should exist");

    const reviewers = loadReviewers({ actionPath: ACTION_PATH });
    assert.ok(reviewers.length >= 1, "expected at least one reviewer");

    // Find the language instruction substring that proves the shared
    // file was read. The canonical ZH text starts with "请勿使用 #N 格式".
    const last = reviewers[reviewers.length - 1];
    assert.ok(
      last.prompt.includes("请勿使用 #N 格式"),
      `expected shared/prompts/hash-avoid-zh.txt content in reviewer prompt; got tail: ${last.prompt.slice(-200)}`,
    );
  });

  it("appends English hash-avoid when MULTI_REVIEW_LANGUAGE=en", () => {
    process.env.MULTI_REVIEW_LANGUAGE = "en";
    const reviewers = loadReviewers({ actionPath: ACTION_PATH });
    const last = reviewers[reviewers.length - 1];
    assert.ok(last.prompt.includes("Respond entirely in English"));
    assert.ok(
      last.prompt.includes("Never use #N format"),
      "expected shared/prompts/hash-avoid-en.txt content in reviewer prompt",
    );
  });

  it("fails loudly when actionPath is empty", () => {
    assert.throws(
      () => loadReviewers({ actionPath: "" }),
      /actionPath is empty/,
    );
  });

  it("fails loudly when shared/prompts/ is missing", () => {
    // Point actionPath at a directory that has no ../shared sibling.
    assert.throws(
      () => loadReviewers({ actionPath: "/tmp" }),
      /hash-avoid prompt files missing/,
    );
  });
});
