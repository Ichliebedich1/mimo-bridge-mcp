import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TaskStore } from "../dist/services/task-store.js";
import { RunningTaskRegistry } from "../dist/services/running-tasks.js";
import { TaskQueue } from "../dist/services/task-queue.js";
import { createAgentStartTaskHandler } from "../dist/tools/agent-start-task.js";
import { createAgentReplyTaskHandler } from "../dist/tools/agent-reply-task.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testDir = join(__dirname, "test-agent-reply-task");

function initRepo(repoDir) {
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "master"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
  writeFileSync(join(repoDir, "README.md"), "fixture\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir });
}

async function waitForTerminal(store, taskId) {
  for (let i = 0; i < 40; i++) {
    const task = store.getTask(taskId);
    if (task?.status === "review" || task?.status === "failed") {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return store.getTask(taskId);
}

test("agent_reply_task resumes a Reasonix TUI task through recorded session path", async () => {
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
  const config = {
    mimoNodePath: process.execPath,
    mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
    allowedRoots: [repoDir],
    runtimeDir,
    agents: [],
  };
  const agents = [
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
  ];

  try {
    const startHandler = createAgentStartTaskHandler(config, agents, store, { runningTasks, taskQueue });
    const replyHandler = createAgentReplyTaskHandler(config, agents, store, { runningTasks, taskQueue });

    const started = await startHandler.handler({
      agent_id: "reasonix-tui",
      objective: "Create initial Reasonix output",
      workspace_path: repoDir,
      editable_paths: ["src"],
      readonly_paths: [],
      acceptance_criteria: ["src/reasonix-output.txt exists"],
      use_worktree: true,
      runtime_timeout_seconds: 60,
    });
    assert.strictEqual(started.status, "running");

    const firstRound = await waitForTerminal(store, started.task_id);
    assert.ok(firstRound);
    assert.strictEqual(firstRound.status, "review");
    assert.ok(firstRound.worktree);
    assert.ok(firstRound.agent_session_path);
    assert.strictEqual(firstRound.current_round, 2);

    const reply = await replyHandler.handler({
      task_id: started.task_id,
      agent_id: "reasonix-tui",
      message: "Continue the same Reasonix session and write src/reasonix-followup.txt",
      priority: 5,
    });
    assert.strictEqual(reply.status, "running");

    const secondRound = await waitForTerminal(store, started.task_id);
    assert.ok(secondRound);
    assert.strictEqual(secondRound.status, "review");
    assert.strictEqual(secondRound.current_round, 3);
    assert.strictEqual(existsSync(join(secondRound.worktree.worktree_path, "src", "reasonix-followup.txt")), true);
    assert.ok(secondRound.review_package.changed_files.includes("src/reasonix-followup.txt"));
    assert.match(secondRound.summary, /resumed previous session/);
  } finally {
    runningTasks.cancelAll();
    taskQueue.cancelAll();
    rmSync(testDir, { recursive: true, force: true });
  }
});

test("agent_reply_task rejects Reasonix reply when no session path is recorded", async () => {
  const runtimeDir = join(testDir, "missing-session-runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const store = new TaskStore(runtimeDir);
  const task = store.createTask(
    {
      objective: "missing session",
      workspace_path: runtimeDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 3,
      runtime_timeout_seconds: 60,
    },
    { agent: "reasonix-tui" }
  );
  store.updateTaskStatus(task.task_id, "review");

  const handler = createAgentReplyTaskHandler(
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
      task_id: task.task_id,
      agent_id: "reasonix-tui",
      message: "continue",
    });
    assert.match(result.error, /no recorded session path/);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});
