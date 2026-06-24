import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  computeTaskScope,
  shouldAutoIncludeTests,
  isPathInsideScope,
  checkScopeCompliance,
} from "../dist/services/task-scope.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-task-scope");

describe("task-scope", () => {
  before(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("computeTaskScope", () => {
    it("defaults to strict mode", () => {
      const result = computeTaskScope({
        workspace_path: testDir,
        editable_paths: ["src"],
      });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.snapshot.mode, "strict");
    });

    it("normalizes editable_paths and writes to snapshot", () => {
      const result = computeTaskScope({
        workspace_path: testDir,
        editable_paths: ["src/services", "tests"],
      });
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.snapshot.requested_editable_paths, ["src/services", "tests"]);
      assert.deepStrictEqual(result.snapshot.effective_editable_paths, ["src/services", "tests"]);
    });

    it("rejects paths containing ..", () => {
      const result = computeTaskScope({
        workspace_path: testDir,
        editable_paths: ["../outside"],
      });
      assert.strictEqual(result.ok, false);
      assert.match(result.error, /不允许包含|超出工作区/);
    });

    it("rejects repo-wide without confirmation", () => {
      const result = computeTaskScope({
        workspace_path: testDir,
        scope_mode: "repo-wide",
        repo_wide_confirmed: false,
      });
      assert.strictEqual(result.ok, false);
      assert.match(result.error, /需要显式确认/);
    });

    it("accepts repo-wide with explicit confirmation", () => {
      const result = computeTaskScope({
        workspace_path: testDir,
        scope_mode: "repo-wide",
        repo_wide_confirmed: true,
      });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.snapshot.mode, "repo-wide");
      assert.strictEqual(result.snapshot.repo_wide_confirmed, true);
      assert.deepStrictEqual(result.snapshot.effective_editable_paths, ["**"]);
      assert.deepStrictEqual(result.effective_config.editable_paths, []);
    });

    it("auto-include tests does not blindly add tests for documentation tasks", () => {
      const result = computeTaskScope({
        workspace_path: testDir,
        editable_paths: ["src/app.ts"],
        include_tests: "auto",
        objective: "更新文档 README",
      });
      assert.strictEqual(result.ok, true);
      const editable = result.effective_config.editable_paths;
      assert.ok(!editable.some((p) => p.includes("__tests__") || p.includes(".test.")));
    });

    it("auto-include tests adds test paths for feature tasks", () => {
      const result = computeTaskScope({
        workspace_path: testDir,
        editable_paths: ["src/app.ts"],
        include_tests: "auto",
        objective: "实现新的登录功能",
      });
      assert.strictEqual(result.ok, true);
      const editable = result.effective_config.editable_paths;
      assert.ok(editable.length > 1);
    });

    it("explicit include_tests=never does not add test paths", () => {
      const result = computeTaskScope({
        workspace_path: testDir,
        editable_paths: ["src/app.ts"],
        include_tests: "never",
        objective: "实现新的登录功能",
      });
      assert.strictEqual(result.ok, true);
      const editable = result.effective_config.editable_paths;
      assert.strictEqual(editable.length, 1);
    });

    it("explicit include_tests=always adds test paths even for docs", () => {
      const result = computeTaskScope({
        workspace_path: testDir,
        editable_paths: ["src/app.ts"],
        include_tests: "always",
        objective: "更新文档",
      });
      assert.strictEqual(result.ok, true);
      const editable = result.effective_config.editable_paths;
      assert.ok(editable.length > 1);
    });
  });

  describe("isPathInsideScope", () => {
    it("returns true for path inside scope", () => {
      assert.strictEqual(isPathInsideScope("src/app.ts", ["src"], "/workspace"), true);
    });

    it("returns false for path outside scope", () => {
      assert.strictEqual(isPathInsideScope("docs/readme.md", ["src"], "/workspace"), false);
    });

    it("returns true for repo-wide scope", () => {
      assert.strictEqual(isPathInsideScope("any/path.ts", ["**"], "/workspace"), true);
    });
  });

  describe("checkScopeCompliance", () => {
    it("treats empty effective scope as legacy unrestricted scope", () => {
      const result = checkScopeCompliance(
        ["src/app.ts", "docs/readme.md"],
        [],
        "/workspace"
      );
      assert.deepStrictEqual(result.inside, ["src/app.ts", "docs/readme.md"]);
      assert.deepStrictEqual(result.outside, []);
      assert.strictEqual(result.hasOutOfScope, false);
    });

    it("separates inside and outside files", () => {
      const result = checkScopeCompliance(
        ["src/app.ts", "docs/readme.md", "src/utils.ts"],
        ["src"],
        "/workspace"
      );
      assert.deepStrictEqual(result.inside, ["src/app.ts", "src/utils.ts"]);
      assert.deepStrictEqual(result.outside, ["docs/readme.md"]);
      assert.strictEqual(result.hasOutOfScope, true);
    });

    it("returns no out-of-scope when all files are inside", () => {
      const result = checkScopeCompliance(
        ["src/app.ts", "src/utils.ts"],
        ["src"],
        "/workspace"
      );
      assert.strictEqual(result.hasOutOfScope, false);
      assert.deepStrictEqual(result.outside, []);
    });
  });
});
