import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-fake-mimo");

describe("fake-mimo scenarios", () => {
  before(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "briefs"), { recursive: true });
    mkdirSync(join(testDir, "workspace"), { recursive: true });

    writeFileSync(join(testDir, "briefs", "task_test-round-1.md"), "# 任务说明\n\n测试任务目标\n");
    writeFileSync(join(testDir, "briefs", "task_test-round-2.md"), "# 任务说明\n\n回复内容\n");
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function runFakeMimo(args, env = {}) {
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");
    const nodePath = process.execPath;

    return new Promise((resolve, reject) => {
      const proc = spawn(nodePath, [fakeMimoPath, ...args], {
        shell: false,
        env: { ...process.env, ...env },
      });

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

  it("success: should complete new task successfully", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", briefPath, "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "success" });

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("sessionID"));
    assert.ok(result.stdout.includes("任务说明"));
  });

  it("continue: should complete continuation task successfully", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-2.md");
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--session", "ses_test123", "--file", briefPath, "--dir", workspacePath,
      "--format", "json", "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "continue" });

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("ses_test123"));
    assert.ok(result.stdout.includes("收到回复"));
  });

  it("no_session: should succeed but without sessionID", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", briefPath, "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "no_session" });

    assert.strictEqual(result.code, 0);
    assert.ok(!result.stdout.includes("ses_fake_"));
  });

  it("exit_error: should exit with non-zero code", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", briefPath, "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "exit_error" });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("模拟退出错误"));
  });

  it("stderr: should output warnings to stderr", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", briefPath, "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "stderr" });

    assert.strictEqual(result.code, 0);
    assert.ok(result.stderr.includes("警告"));
    assert.ok(result.stdout.includes("sessionID"));
  });

  it("malformed: should output malformed JSON then valid JSON", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", briefPath, "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "malformed" });

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("这不是JSON"));
    assert.ok(result.stdout.includes("sessionID"));
  });

  it("missing file: should reject when --file is missing", async () => {
    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("缺少 --file 参数"));
  });

  it("missing dir: should reject when --dir is missing", async () => {
    const briefPath = join(testDir, "briefs", "task_test-round-1.md");

    const result = await runFakeMimo([
      "run", "--file", briefPath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("缺少 --dir 参数"));
  });

  it("missing marker: should reject when file lacks # 任务说明", async () => {
    const invalidBrief = join(testDir, "briefs", "invalid-marker.md");
    writeFileSync(invalidBrief, "这不是有效的任务说明\n", "utf-8");

    const workspacePath = join(testDir, "workspace");

    const result = await runFakeMimo([
      "run", "--file", invalidBrief, "--dir", workspacePath, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ]);

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("任务说明") || result.stderr.includes("标记"));
  });
});
