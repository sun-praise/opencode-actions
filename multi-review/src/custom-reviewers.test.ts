import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadReviewers } from "./reviewers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_PATH = resolve(HERE, "..");

describe("loadReviewers custom personas", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;

  before(() => {
    process.env.MULTI_REVIEW_DEFAULT_TEAM = "quality:1";
    process.env.MULTI_REVIEW_LANGUAGE = "zh";
    tmpDir = join(tmpdir(), "multi-review-custom-test");
  });

  after(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads custom personas from .github/reviewers/", () => {
    const reviewersDir = join(tmpDir, ".github", "reviewers");
    mkdirSync(reviewersDir, { recursive: true });
    writeFileSync(join(reviewersDir, "accessibility.yaml"), [
      "name: accessibility",
      "prompt: |",
      "  Review for accessibility.",
    ].join("\n"));

    process.env.MULTI_REVIEW_DEFAULT_TEAM = "accessibility:1";
    const reviewers = loadReviewers({ actionPath: ACTION_PATH, repoDir: tmpDir });
    assert.equal(reviewers.length, 1);
    assert.equal(reviewers[0].name, "accessibility");
    assert.ok(reviewers[0].prompt.startsWith("Review for accessibility."));
  });

  it("custom persona overrides built-in with same name", () => {
    const reviewersDir = join(tmpDir, ".github", "reviewers");
    mkdirSync(reviewersDir, { recursive: true });
    writeFileSync(join(reviewersDir, "quality.yaml"), [
      "name: quality",
      "prompt: |",
      "  Custom quality review.",
    ].join("\n"));

    process.env.MULTI_REVIEW_DEFAULT_TEAM = "quality:1";
    const reviewers = loadReviewers({ actionPath: ACTION_PATH, repoDir: tmpDir });
    assert.equal(reviewers.length, 1);
    assert.ok(reviewers[0].prompt.startsWith("Custom quality review."));
  });

  it("silently skips when .github/reviewers/ does not exist", () => {
    process.env.MULTI_REVIEW_DEFAULT_TEAM = "quality:1";
    const reviewers = loadReviewers({ actionPath: ACTION_PATH, repoDir: tmpDir });
    assert.equal(reviewers.length, 1);
    assert.equal(reviewers[0].name, "quality");
  });

  it("skips invalid YAML with a warning", () => {
    const reviewersDir = join(tmpDir, ".github", "reviewers");
    mkdirSync(reviewersDir, { recursive: true });
    writeFileSync(join(reviewersDir, "broken.yaml"), "not: valid: yaml: :::");

    process.env.MULTI_REVIEW_DEFAULT_TEAM = "quality:1";
    const reviewers = loadReviewers({ actionPath: ACTION_PATH, repoDir: tmpDir });
    assert.equal(reviewers.length, 1);
  });

  it("skips YAML missing required fields", () => {
    const reviewersDir = join(tmpDir, ".github", "reviewers");
    mkdirSync(reviewersDir, { recursive: true });
    writeFileSync(join(reviewersDir, "empty.yaml"), "name: no-prompt-field");

    process.env.MULTI_REVIEW_DEFAULT_TEAM = "quality:1";
    const reviewers = loadReviewers({ actionPath: ACTION_PATH, repoDir: tmpDir });
    assert.equal(reviewers.length, 1);
  });

  it("loads .yml extension files too", () => {
    const reviewersDir = join(tmpDir, ".github", "reviewers");
    mkdirSync(reviewersDir, { recursive: true });
    writeFileSync(join(reviewersDir, "database.yml"), [
      "name: database",
      "prompt: |",
      "  Review for database schema.",
    ].join("\n"));

    process.env.MULTI_REVIEW_DEFAULT_TEAM = "database:1";
    const reviewers = loadReviewers({ actionPath: ACTION_PATH, repoDir: tmpDir });
    assert.equal(reviewers.length, 1);
    assert.equal(reviewers[0].name, "database");
  });

  it("mixes built-in and custom reviewers", () => {
    const reviewersDir = join(tmpDir, ".github", "reviewers");
    mkdirSync(reviewersDir, { recursive: true });
    writeFileSync(join(reviewersDir, "database.yaml"), [
      "name: database",
      "prompt: |",
      "  Review for database schema.",
    ].join("\n"));

    process.env.MULTI_REVIEW_DEFAULT_TEAM = "quality:1,database:1";
    const reviewers = loadReviewers({ actionPath: ACTION_PATH, repoDir: tmpDir });
    assert.equal(reviewers.length, 2);
    const names = reviewers.map((r) => r.name).sort();
    assert.deepEqual(names, ["database", "quality"]);
  });
});
