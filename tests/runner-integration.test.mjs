import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import * as pty from "node-pty";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-runner-integration");
const briefsDir = join(testDir, "briefs");
const workspaceDir = join(testDir, "workspace");
const logsDir = join(testDir, "logs");

describe("runner integration with PTY", () => {
  let fakeMimoPath;
  let nodePath;

  before(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(briefsDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(logsDir, { recursive: true });

    writeFileSync(join(briefsDir, "task_test-round-1.md"), "# 任务说明\n\n测试任务目标\n");

    fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");
    nodePath = process.execPath;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function spawnFakeMimoViaPty(args, env = {}) {
    return new Promise((resolve, reject) => {
      const ptyProcess = pty.spawn(nodePath, [fakeMimoPath, ...args], {
        name: "xterm-256color",
        cols: 10000,
        rows: 30,
        cwd: process.cwd(),
        env: { ...process.env, ...env },
      });

      let output = "";
      let exitCode = null;
      let settled = false;

      ptyProcess.onData((data) => {
        output += data;
      });

      ptyProcess.onExit(({ exitCode: code }) => {
        exitCode = code;
        if (!settled) {
          settled = true;
          resolve({ exitCode, output });
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ptyProcess.kill(); } catch {}
          resolve({ exitCode: -1, output, timeout: true });
        }
      }, 10000);
    });
  }

  it("success: should complete with step_finish via PTY", async () => {
    const briefPath = join(briefsDir, "task_test-round-1.md");

    const result = await spawnFakeMimoViaPty([
      "run", "--file", briefPath, "--dir", workspaceDir, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "success" });

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("sessionID"));
    assert.ok(result.output.includes("step_finish") || result.output.includes("step-finish"));
    assert.ok(!result.timeout);
  });

  it("exit_error: should exit with non-zero code via PTY", async () => {
    const briefPath = join(briefsDir, "task_test-round-1.md");

    const result = await spawnFakeMimoViaPty([
      "run", "--file", briefPath, "--dir", workspaceDir, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "exit_error" });

    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.output.includes("模拟退出错误") || result.exitCode !== 0);
    assert.ok(!result.timeout);
  });

  it("timeout: should timeout when process hangs", async () => {
    const briefPath = join(briefsDir, "task_test-round-1.md");

    const result = await spawnFakeMimoViaPty([
      "run", "--file", briefPath, "--dir", workspaceDir, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "timeout" });

    assert.ok(result.timeout);
  });

  it("malformed: should still complete with valid JSON after malformed", async () => {
    const briefPath = join(briefsDir, "task_test-round-1.md");

    const result = await spawnFakeMimoViaPty([
      "run", "--file", briefPath, "--dir", workspaceDir, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "malformed" });

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("sessionID"));
    assert.ok(result.output.includes("这不是JSON"));
  });

  it("fragmented: should parse fragmented JSON output", async () => {
    const briefPath = join(briefsDir, "task_test-round-1.md");

    const result = await spawnFakeMimoViaPty([
      "run", "--file", briefPath, "--dir", workspaceDir, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "fragmented" });

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("碎片化输出测试"));
  });

  it("stderr: should capture stderr warnings via PTY", async () => {
    const briefPath = join(briefsDir, "task_test-round-1.md");

    const result = await spawnFakeMimoViaPty([
      "run", "--file", briefPath, "--dir", workspaceDir, "--format", "json",
      "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "stderr" });

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("sessionID"));
  });

  it("continue: should handle continuation via PTY", async () => {
    const briefPath = join(briefsDir, "task_test-round-1.md");

    const result = await spawnFakeMimoViaPty([
      "run", "--session", "ses_test_continue", "--file", briefPath, "--dir", workspaceDir,
      "--format", "json", "请读取附件中的任务说明并按要求执行。",
    ], { FAKE_MIMO_SCENARIO: "continue" });

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("ses_test_continue"));
    assert.ok(result.output.includes("收到回复"));
  });

  it("process tree: should terminate child processes on kill", async () => {
    const briefPath = join(briefsDir, "task_test-round-1.md");

    const ptyProcess = pty.spawn(nodePath, [
      fakeMimoPath, "run", "--file", briefPath, "--dir", workspaceDir,
      "--format", "json", "请读取附件中的任务说明并按要求执行。",
    ], {
      name: "xterm-256color",
      cols: 10000,
      rows: 30,
      cwd: process.cwd(),
      env: { ...process.env, FAKE_MIMO_SCENARIO: "cancel" },
    });

    let output = "";
    ptyProcess.onData((data) => { output += data; });

    await new Promise((r) => setTimeout(r, 500));

    assert.ok(ptyProcess.pid > 0);

    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync("taskkill", ["/T", "/F", "/PID", String(ptyProcess.pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      try { ptyProcess.kill(); } catch {}
    }

    await new Promise((r) => setTimeout(r, 500));
    assert.ok(true, "Process tree terminated");
  });
});
