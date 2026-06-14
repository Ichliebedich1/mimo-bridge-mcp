import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  validateWorkspacePath,
  validateEditablePaths,
  validateSessionId,
  validateMaxRounds,
  validateTimeout,
} from "../dist/services/path-guard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-paths");

describe("path-guard", () => {
  before(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "root"), { recursive: true });
    mkdirSync(join(testDir, "root-escape"), { recursive: true });
    mkdirSync(join(testDir, "root", "subdir"), { recursive: true });
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should reject relative paths", () => {
    const result = validateWorkspacePath("relative/path", [testDir]);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason.includes("绝对路径"));
  });

  it("should reject paths outside allowed roots", () => {
    const result = validateWorkspacePath("C:\\Windows\\System32", [testDir]);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason.includes("不在允许的根目录范围内"));
  });

  it("should reject adjacent directory with similar prefix", () => {
    const rootPath = join(testDir, "root");
    const escapePath = join(testDir, "root-escape");

    const result = validateWorkspacePath(escapePath, [rootPath]);
    assert.strictEqual(result.allowed, false);
  });

  it("should accept subdirectory of allowed root", () => {
    const rootPath = join(testDir, "root");
    const subdirPath = join(testDir, "root", "subdir");

    const result = validateWorkspacePath(subdirPath, [rootPath]);
    assert.strictEqual(result.allowed, true);
  });

  it("should reject path with .. traversal", () => {
    const rootPath = join(testDir, "root");
    const traversalPath = join(testDir, "root", "..", "root-escape");

    const result = validateWorkspacePath(traversalPath, [rootPath]);
    assert.strictEqual(result.allowed, false);
  });

  it("should accept valid session ID", () => {
    const result = validateSessionId("ses_abc123def456");
    assert.strictEqual(result.allowed, true);
  });

  it("should accept session ID with underscores", () => {
    const result = validateSessionId("ses_fake_xxx");
    assert.strictEqual(result.allowed, true);
  });

  it("should reject invalid session ID", () => {
    const result = validateSessionId("invalid-session-id!");
    assert.strictEqual(result.allowed, false);
  });

  it("should accept valid max rounds", () => {
    const result = validateMaxRounds(5);
    assert.strictEqual(result.allowed, true);
  });

  it("should reject max rounds out of range", () => {
    const result = validateMaxRounds(15);
    assert.strictEqual(result.allowed, false);
  });

  it("should accept valid timeout", () => {
    const result = validateTimeout(900);
    assert.strictEqual(result.allowed, true);
  });

  it("should reject timeout out of range", () => {
    const result = validateTimeout(30);
    assert.strictEqual(result.allowed, false);
  });

  it("should reject editable paths with ..", () => {
    const result = validateEditablePaths(["../outside"], "C:\\test");
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason.includes(".."));
  });

  it("should accept editable paths within workspace", () => {
    const result = validateEditablePaths(["src", "tests"], "C:\\test");
    assert.strictEqual(result.allowed, true);
  });
});
