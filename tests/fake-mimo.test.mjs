import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-fake-mimo");

describe("fake-mimo", () => {
  before(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "briefs"), { recursive: true });
    mkdirSync(join(testDir, "workspace"), { recursive: true });

    writeFileSync(join(testDir, "briefs", "task_test-round-1.md"), "# 任务说明\n\n测试任务目标\n");
    writeFileSync(join(testDir, "briefs", "task_test-round-2.md"), "# 任务说明\n\n测试回复内容\n");
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function runFakeMimo(args) {
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");
    const nodePath = process.execPath;

    return new Promise((resolve, reject) => {
      const proc = spawn(nodePath, [fakeMimoPath, ...args], { shell: false });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });

      proc.on("error", reject);
    });
  }

  it("should output valid JSONL events for new task", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", briefPath, "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("sessionID"));
    assert.ok(result.stdout.includes("任务说明"));
  });

  it("should handle --session parameter for continuation", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-2.md");
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--session", "ses_test123", "--file", briefPath, "--dir", workspacePath,
      "--format", "json", "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("ses_test123"));
    assert.ok(result.stdout.includes("收到回复"));
  });

  it("should reject new task without --file", async () => {
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("缺少 --file 参数"));
  });

  it("should reject new task without --dir", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");

    const result = await runFakeMimo([
      "run", "--file", briefPath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("缺少 --dir 参数"));
  });

  it("should reject task with missing # 任务说明 marker", async () => {
    const invalidBrief = join(testDir, "briefs", "invalid.md");
    writeFileSync(invalidBrief, "这不是有效的任务说明\n");

    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", invalidBrief, "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("缺少 '# 任务说明' 标记"));
  });

  it("should reject task with non-existent file", async () => {
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", "C:\\nonexistent\\file.md", "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("文件不存在"));
  });

  it("should reject continuation without --file", async () => {
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--session", "ses_test", "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("缺少 --file 参数"));
  });

  it("should succeed as new task when --session is omitted", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", briefPath, "--dir", workspacePath,
      "--format", "json", "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("收到任务说明"));
  });
});
