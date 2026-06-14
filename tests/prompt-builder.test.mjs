import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { buildTaskBrief, writeTaskBrief, buildReplyBrief, writeReplyBrief } from "../dist/services/prompt-builder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-prompt-builder");

describe("prompt-builder", () => {
  before(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "briefs"), { recursive: true });
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should build task brief with all fields", () => {
    const config = {
      objective: "实现登录功能",
      workspace_path: "C:\\test",
      editable_paths: ["src/login", "tests/login"],
      readonly_paths: ["src/config.ts"],
      acceptance_criteria: ["登录成功", "测试通过"],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    };

    const brief = buildTaskBrief(config);

    assert.ok(brief.includes("# 任务说明"));
    assert.ok(brief.includes("实现登录功能"));
    assert.ok(brief.includes("src/login"));
    assert.ok(brief.includes("tests/login"));
    assert.ok(brief.includes("src/config.ts"));
    assert.ok(brief.includes("登录成功"));
    assert.ok(brief.includes("测试通过"));
  });

  it("should build task brief with minimal fields", () => {
    const config = {
      objective: "简单任务",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    };

    const brief = buildTaskBrief(config);

    assert.ok(brief.includes("# 任务说明"));
    assert.ok(brief.includes("简单任务"));
    assert.ok(!brief.includes("允许修改的文件范围"));
    assert.ok(!brief.includes("只读参考文件"));
    assert.ok(!brief.includes("验收条件"));
  });

  it("should write task brief to file", () => {
    const config = {
      objective: "写入测试",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    };

    const briefPath = writeTaskBrief(config, "task_test123", 1, join(testDir, "briefs"));

    assert.ok(existsSync(briefPath));
    assert.ok(briefPath.includes("task_test123-round-1.md"));

    const content = readFileSync(briefPath, "utf-8");
    assert.ok(content.includes("写入测试"));
  });

  it("should build reply brief", () => {
    const reply = buildReplyBrief("请修改登录逻辑");

    assert.ok(reply.includes("# 回复"));
    assert.ok(reply.includes("请修改登录逻辑"));
  });

  it("should write reply brief to file", () => {
    const briefPath = writeReplyBrief("回复测试", "task_test456", 2, join(testDir, "briefs"));

    assert.ok(existsSync(briefPath));
    assert.ok(briefPath.includes("task_test456-round-2.md"));

    const content = readFileSync(briefPath, "utf-8");
    assert.ok(content.includes("回复测试"));
  });
});
