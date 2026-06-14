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
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should output valid JSONL events", async () => {
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");
    const nodePath = process.execPath;
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");
    const workspacePath = join(testDir, "workspace");

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(nodePath, [
        fakeMimoPath,
        "run",
        "--file", briefPath,
        "--dir", workspacePath,
        "--format", "json",
        "请读取附件中的任务说明并按要求执行。",
      ], {
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });

      proc.on("error", reject);
    });

    assert.strictEqual(result.code, 0);

    const lines = result.stdout.trim().split("\n");
    assert.ok(lines.length >= 3, "应该至少有 3 行 JSON 事件");

    for (const line of lines) {
      const event = JSON.parse(line);
      assert.ok(event.type, "事件应该有 type 字段");
      assert.ok(event.sessionID, "事件应该有 sessionID 字段");
    }

    const textEvent = JSON.parse(lines.find((line) => JSON.parse(line).type === "text"));
    assert.ok(textEvent.part.text.includes("任务说明"), "应该包含任务说明摘要");
  });

  it("should handle --session parameter for continuation", async () => {
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");
    const nodePath = process.execPath;
    const briefPath = join(testDir, "briefs", "task_test-round-2.md");
    const workspacePath = join(testDir, "workspace");

    writeFileSync(briefPath, "# 回复\n\n测试回复内容\n");

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(
        nodePath,
        [
          fakeMimoPath,
          "run",
          "--session", "ses_test123",
          "--file", briefPath,
          "--dir", workspacePath,
          "--format", "json",
          "请读取附件中的任务说明并按要求执行。",
        ],
        { shell: false }
      );

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });

      proc.on("error", reject);
    });

    assert.strictEqual(result.code, 0);

    const lines = result.stdout.trim().split("\n");
    const textEvent = JSON.parse(lines.find((line) => JSON.parse(line).type === "text"));
    assert.ok(textEvent.part.text.includes("收到回复"), "续接任务应该返回续接回复");
    assert.ok(textEvent.sessionID === "ses_test123", "应该返回原 session_id");
  });

  it("should reject new task without --file", async () => {
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");
    const nodePath = process.execPath;
    const workspacePath = join(testDir, "workspace");

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(nodePath, [
        fakeMimoPath,
        "run",
        "--dir", workspacePath,
        "--format", "json",
        "请读取附件中的任务说明并按要求执行。",
      ], {
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });

      proc.on("error", reject);
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("缺少 --file 参数"));
  });

  it("should reject new task without --dir", async () => {
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");
    const nodePath = process.execPath;
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(nodePath, [
        fakeMimoPath,
        "run",
        "--file", briefPath,
        "--format", "json",
        "请读取附件中的任务说明并按要求执行。",
      ], {
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });

      proc.on("error", reject);
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("缺少 --dir 参数"));
  });
});
