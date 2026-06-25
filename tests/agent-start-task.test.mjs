import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TaskStore } from "../dist/services/task-store.js";
import { RunningTaskRegistry } from "../dist/services/running-tasks.js";
import { TaskQueue } from "../dist/services/task-queue.js";
import { createAgentStartTaskHandler } from "../dist/tools/agent-start-task.js";
import { globalTokenBudget } from "../dist/services/token-budget.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testDir = join(__dirname, "test-agent-start-task");

function initRepo(repoDir) {
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "master"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
  writeFileSync(join(repoDir, "README.md"), "fixture\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir });
}

test("agent_start_task runs Reasonix TUI one-shot task through Worktree review flow", async () => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  const repoDir = join(testDir, "repo");
  const runtimeDir = join(testDir, "runtime");
  const reasonixHome = join(testDir, "ReasonixData");
  initRepo(repoDir);
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(reasonixHome, { recursive: true });

  const store = new TaskStore(runtimeDir);
  const runningTasks = new RunningTaskRegistry();
  const taskQueue = new TaskQueue(1);
  const handler = createAgentStartTaskHandler(
    {
      mimoNodePath: process.execPath,
      mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
      allowedRoots: [repoDir],
      runtimeDir,
      agents: [],
    },
    [
      {
        id: "mimo",
        kind: "mimo",
        display_name: "MiMo Code",
        enabled: true,
      },
      {
        id: "reasonix-tui",
        kind: "reasonix-tui",
        display_name: "Reasonix TUI",
        enabled: true,
        command: process.execPath,
        command_args: [join(__dirname, "fixtures", "fake-reasonix.mjs")],
        home_dir: reasonixHome,
        max_steps: 3,
      },
    ],
    store,
    { runningTasks, taskQueue }
  );

  try {
    const started = await handler.handler({
      agent_id: "reasonix-tui",
      objective: "Use Reasonix fake runner to create src/reasonix-output.txt",
      workspace_path: repoDir,
      editable_paths: ["src"],
      readonly_paths: [],
      acceptance_criteria: ["src/reasonix-output.txt exists"],
      use_worktree: true,
      runtime_timeout_seconds: 60,
    });

    assert.strictEqual(started.status, "running");
    assert.ok(started.task_id);

    for (let i = 0; i < 30; i++) {
      const task = store.getTask(started.task_id);
      if (task?.status === "review" || task?.status === "failed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const task = store.getTask(started.task_id);
    assert.ok(task);
    assert.strictEqual(task.agent, "reasonix-tui");
    assert.strictEqual(task.status, "review");
    assert.ok(task.worktree);
    assert.strictEqual(existsSync(join(task.worktree.worktree_path, "src", "reasonix-output.txt")), true);
    assert.ok(task.review_package);
    assert.strictEqual(task.review_package.status, "review");
    assert.strictEqual(task.review_package.changed_files.includes("src/reasonix-output.txt"), true);
    assert.strictEqual(task.review_package.review_recommendation, "approve");
    assert.ok(task.agent_session_path);
    assert.match(task.agent_session_path, /task_[a-f0-9]{12}.*\.jsonl$/);
    assert.strictEqual(task.agent_session_path.startsWith(reasonixHome), true);
    assert.match(task.summary, /Reasonix fake/);
  } finally {
    runningTasks.cancelAll();
    taskQueue.cancelAll();
    rmSync(testDir, { recursive: true, force: true });
  }
});

test("agent_start_task rejects unknown agents", async () => {
  const runtimeDir = join(testDir, "unknown-runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const store = new TaskStore(runtimeDir);
  const handler = createAgentStartTaskHandler(
    {
      mimoNodePath: process.execPath,
      mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
      allowedRoots: [runtimeDir],
      runtimeDir,
      agents: [],
    },
    [],
    store
  );

  try {
    const result = await handler.handler({
      agent_id: "missing-agent",
      objective: "no-op",
      workspace_path: runtimeDir,
    });
    assert.match(result.error, /Unknown agent_id/);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("agent_start_task auto routing can select Reasonix from scenario profile", async () => {
  const routeDir = mkdtempSync(join(tmpdir(), "agent-start-auto-routing-"));
  const repoDir = join(routeDir, "repo");
  const runtimeDir = join(routeDir, "runtime");
  const reasonixHome = join(routeDir, "ReasonixData");
  const argsPath = join(routeDir, "reasonix-args.json");
  initRepo(repoDir);
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(reasonixHome, { recursive: true });

  const store = new TaskStore(runtimeDir);
  const runningTasks = new RunningTaskRegistry();
  const taskQueue = new TaskQueue(1);
  const handler = createAgentStartTaskHandler(
    {
      mimoNodePath: process.execPath,
      mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
      allowedRoots: [repoDir],
      runtimeDir,
      agents: [],
      routingProfiles: {
        scenarios: {
          normal: {
            agent_id: "reasonix-tui",
            model: "deepseek-v4-flash",
            reasoning_effort: "low",
          },
        },
      },
    },
    [
      {
        id: "mimo",
        kind: "mimo",
        display_name: "MiMo Code",
        enabled: true,
      },
      {
        id: "reasonix-tui",
        kind: "reasonix-tui",
        display_name: "Reasonix TUI",
        enabled: true,
        command: process.execPath,
        command_args: [join(__dirname, "fixtures", "fake-reasonix.mjs")],
        home_dir: reasonixHome,
      },
    ],
    store,
    { runningTasks, taskQueue }
  );

  const previousArgsPath = process.env.FAKE_REASONIX_ARGS_PATH;
  process.env.FAKE_REASONIX_ARGS_PATH = argsPath;
  try {
    const started = await handler.handler({
      agent_id: "auto",
      objective: "auto route normal task",
      workspace_path: repoDir,
      editable_paths: ["src"],
      readonly_paths: [],
      acceptance_criteria: ["src/reasonix-output.txt exists"],
      task_scenario: "normal",
      use_worktree: true,
      runtime_timeout_seconds: 60,
    });

    assert.strictEqual(started.status, "running");
    assert.ok(started.task_id);
    for (let i = 0; i < 30; i++) {
      const task = store.getTask(started.task_id);
      if (task?.status === "review" || task?.status === "failed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const task = store.getTask(started.task_id);
    assert.strictEqual(task.agent, "reasonix-tui");
    assert.strictEqual(task.config.routing.agent_id, "reasonix-tui");
    assert.strictEqual(task.config.routing.model, "deepseek-v4-flash");
    assert.strictEqual(task.config.routing.reasoning_effort, "low");
    const args = JSON.parse(readFileSync(argsPath, "utf-8"));
    assert.deepStrictEqual(args.slice(0, 5), [
      "run",
      "--model",
      "deepseek-v4-flash",
      "--max-steps",
      "10",
    ]);
  } finally {
    if (previousArgsPath === undefined) {
      delete process.env.FAKE_REASONIX_ARGS_PATH;
    } else {
      process.env.FAKE_REASONIX_ARGS_PATH = previousArgsPath;
    }
    runningTasks.cancelAll();
    taskQueue.cancelAll();
    rmSync(routeDir, { recursive: true, force: true });
  }
});

test("agent_start_task rejects Reasonix multimodal routing before starting a task", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "agent-start-reject-multimodal-"));
  mkdirSync(runtimeDir, { recursive: true });
  const store = new TaskStore(runtimeDir);
  const handler = createAgentStartTaskHandler(
    {
      mimoNodePath: process.execPath,
      mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
      allowedRoots: [runtimeDir],
      runtimeDir,
      agents: [],
    },
    [
      {
        id: "reasonix-tui",
        kind: "reasonix-tui",
        display_name: "Reasonix TUI",
        enabled: true,
        command: process.execPath,
        command_args: [join(__dirname, "fixtures", "fake-reasonix.mjs")],
        home_dir: runtimeDir,
      },
    ],
    store
  );

  try {
    const result = await handler.handler({
      agent_id: "reasonix-tui",
      objective: "image task",
      workspace_path: runtimeDir,
      task_scenario: "multimodal",
      model: "deepseek-v4-flash",
    });
    assert.ok(result.error);
    assert.match(result.error, /多模态/);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("agent_start_task records Reasonix token usage only when session exposes real usage", async () => {
  const usageDir = join(testDir, "usage");
  if (existsSync(usageDir)) {
    rmSync(usageDir, { recursive: true, force: true });
  }
  const repoDir = join(usageDir, "repo");
  const runtimeDir = join(usageDir, "runtime");
  const reasonixHome = join(usageDir, "ReasonixData");
  initRepo(repoDir);
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(reasonixHome, { recursive: true });

  const store = new TaskStore(runtimeDir);
  const runningTasks = new RunningTaskRegistry();
  const taskQueue = new TaskQueue(1);
  const handler = createAgentStartTaskHandler(
    {
      mimoNodePath: process.execPath,
      mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
      allowedRoots: [repoDir],
      runtimeDir,
      agents: [],
    },
    [
      {
        id: "mimo",
        kind: "mimo",
        display_name: "MiMo Code",
        enabled: true,
      },
      {
        id: "reasonix-tui",
        kind: "reasonix-tui",
        display_name: "Reasonix TUI",
        enabled: true,
        command: process.execPath,
        command_args: [join(__dirname, "fixtures", "fake-reasonix.mjs")],
        home_dir: reasonixHome,
        max_steps: 3,
      },
    ],
    store,
    { runningTasks, taskQueue }
  );

  const previousUsageFlag = process.env.FAKE_REASONIX_USAGE;
  process.env.FAKE_REASONIX_USAGE = "1";
  globalTokenBudget.reset();
  try {
    const started = await handler.handler({
      agent_id: "reasonix-tui",
      objective: "Use Reasonix fake runner with token usage",
      workspace_path: repoDir,
      editable_paths: ["src"],
      readonly_paths: [],
      acceptance_criteria: ["src/reasonix-output.txt exists"],
      use_worktree: true,
      runtime_timeout_seconds: 60,
    });

    assert.strictEqual(started.status, "running");
    for (let i = 0; i < 30; i++) {
      const task = store.getTask(started.task_id);
      if (task?.status === "review" || task?.status === "failed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const usage = globalTokenBudget.getUsage();
    assert.strictEqual(usage.input_tokens, 21);
    assert.strictEqual(usage.output_tokens, 9);
    assert.strictEqual(usage.total_tokens, 30);
    assert.strictEqual(usage.estimated_cost, 0.0007);
  } finally {
    if (previousUsageFlag === undefined) {
      delete process.env.FAKE_REASONIX_USAGE;
    } else {
      process.env.FAKE_REASONIX_USAGE = previousUsageFlag;
    }
    globalTokenBudget.reset();
    runningTasks.cancelAll();
    taskQueue.cancelAll();
    rmSync(usageDir, { recursive: true, force: true });
  }
});
