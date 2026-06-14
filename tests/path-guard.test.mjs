import { describe, it } from "node:test";
import assert from "node:assert";
import {
  validateWorkspacePath,
  validateEditablePaths,
  validateSessionId,
  validateMaxRounds,
  validateTimeout,
} from "../dist/services/path-guard.js";

describe("path-guard", () => {
  const allowedRoots = ["C:\\Users\\test\\Desktop"];

  it("should reject relative paths", () => {
    const result = validateWorkspacePath("relative/path", allowedRoots);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason.includes("绝对路径"));
  });

  it("should reject paths outside allowed roots", () => {
    const result = validateWorkspacePath("C:\\Windows\\System32", allowedRoots);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason.includes("不在允许的根目录范围内"));
  });

  it("should accept valid session ID", () => {
    const result = validateSessionId("ses_abc123def456");
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
});
