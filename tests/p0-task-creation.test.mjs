import test from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../dist/services/task-store.js";
import { TaskQueue } from "../dist/services/task-queue.js";
import { RunningTaskRegistry } from "../dist/services/running-tasks.js";
import { createStartTaskHandler } from "../dist/tools/start-task.js";

test("TaskQueue runs eight non-overlapping tasks and queues the ninth", async () => {
  const queue = new TaskQueue(8);
  const releases = [];
  let started = 0;
  for (let index = 0; index < 9; index++) {
    queue.enqueue({
      taskId: `task_${String(index).padStart(12, "0")}`,
      agentId: "mimo",
      workspacePath: "C:/repo",
      editablePaths: [`path-${index}`],
      priority: 5,
      enqueuedAt: Date.now(),
      execute: () => new Promise((resolve) => { started++; releases.push(resolve); }),
      cancel: () => undefined,
    });
  }
  assert.strictEqual(started, 8);
  assert.strictEqual(queue.running, 8);
  assert.strictEqual(queue.size, 1);
  for (const release of releases) release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(started, 9);
  releases[8]();
});

test("start_task immediately persists a Chinese-space-path worktree placeholder and exposes phases", async () => {
  const root = mkdtempSync(join(tmpdir(), "MiMo 中文 project "));
  const repo = join(root, "代码 仓库");
  const runtime = join(root, "运行 数据");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "base.txt"), "base\n");
  execFileSync("git", ["init"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "P0 Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repo });

  const store = new TaskStore(runtime);
  const queue = new TaskQueue(8);
  const running = new RunningTaskRegistry();
  let runnerStarted = false;
  const handler = createStartTaskHandler(config(repo, runtime), store, {
    taskQueue: queue,
    runningTasks: running,
    runTask: () => {
      runnerStarted = true;
      return { cancel: () => undefined };
    },
  });

  try {
    const startedAt = Date.now();
    const result = await handler.handler(input(repo, { use_worktree: true, idempotency_key: "p0-worktree" }));
    assert.ok(Date.now() - startedAt < 5000);
    assert.strictEqual(result.status, "preparing_worktree");
    assert.strictEqual(result.queue_state, "active");
    assert.ok(result.task_id);
    assert.match(result.request_id, /^req_/);
    assert.strictEqual(runnerStarted, false);
    assert.strictEqual(store.getTask(result.task_id).status, "preparing_worktree");

    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(store.getTask(result.task_id).status, "starting_agent");
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(runnerStarted, true);
    assert.strictEqual(store.getTask(result.task_id).status, "running");
    assert.strictEqual(handler.getQueueStatus().capacity, 8);
    assert.strictEqual(handler.getQueueStatus().active[0].requestId, result.request_id);
    running.cancelAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("idempotency_key returns the persisted task and rejects a changed payload", async () => {
  const root = mkdtempSync(join(tmpdir(), "mimo-idempotency-"));
  const store = new TaskStore(join(root, "runtime"));
  const queue = new TaskQueue(0);
  const running = new RunningTaskRegistry();
  const handler = createStartTaskHandler(config(root, join(root, "runtime")), store, {
    taskQueue: queue,
    runningTasks: running,
    runTask: () => ({ cancel: () => undefined }),
  });
  try {
    const first = await handler.handler(input(root, { idempotency_key: "same-key" }));
    const retry = await handler.handler(input(root, { idempotency_key: "same-key" }));
    assert.strictEqual(retry.task_id, first.task_id);
    assert.strictEqual(retry.request_id, first.request_id);
    assert.strictEqual(retry.idempotent_replay, true);
    assert.strictEqual(store.listTasks(20).length, 1);

    const reloadedStore = new TaskStore(join(root, "runtime"));
    reloadedStore.reconcileInterruptedTasks();
    const reloadedHandler = createStartTaskHandler(config(root, join(root, "runtime")), reloadedStore, {
      taskQueue: new TaskQueue(0), runningTasks: new RunningTaskRegistry(), runTask: () => ({ cancel: () => undefined }),
    });
    const afterRestart = await reloadedHandler.handler(input(root, { idempotency_key: "same-key" }));
    assert.strictEqual(afterRestart.task_id, first.task_id);
    assert.strictEqual(afterRestart.status, "failed");
    assert.strictEqual(afterRestart.idempotent_replay, true);

    const conflict = await handler.handler({ ...input(root, { idempotency_key: "same-key" }), objective: "changed" });
    assert.strictEqual(conflict.code, "IDEMPOTENCY_CONFLICT");
    assert.strictEqual(reloadedStore.listTasks(20).length, 1);
    running.cancelAll();
    queue.cancelAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preparation failures persist a structured error and allowedRoots diagnostics do not enumerate roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "mimo-p0-failure-"));
  const outside = mkdtempSync(join(tmpdir(), "mimo-p0-outside-"));
  const runtime = join(root, "runtime");
  const allowedSecret = join(root, "SECRET_OTHER_ALLOWED_ROOT");
  mkdirSync(allowedSecret, { recursive: true });
  const store = new TaskStore(runtime);
  const handler = createStartTaskHandler({
    ...config(allowedSecret, runtime),
    diagnostics: {
      configFile: join(root, "config.json"), configSource: "file", loadedAt: "2026-08-12T00:00:00.000Z",
      fingerprint: "abc123", allowedRootsCount: 1, reloadRequired: false,
      isReloadRequired: () => true, restartCommand: "MiMo Bridge Launcher.cmd restart",
    },
  }, store, { taskQueue: new TaskQueue(8), runningTasks: new RunningTaskRegistry(), runTask: () => ({ cancel: () => undefined }) });
  try {
    const denied = await handler.handler(input(outside));
    assert.strictEqual(denied.code, "WORKSPACE_NOT_ALLOWED");
    assert.strictEqual(denied.details.allowed_roots_count, 1);
    assert.strictEqual(denied.details.reload_required, true);
    assert.strictEqual(JSON.stringify(denied).includes("SECRET_OTHER_ALLOWED_ROOT"), false);

    const failed = await handler.handler(input(allowedSecret, { use_worktree: true }));
    for (let i = 0; i < 50 && store.getTask(failed.task_id)?.status !== "failed"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const task = store.getTask(failed.task_id);
    assert.strictEqual(task.status, "failed");
    assert.strictEqual(task.error_detail.code, "NOT_A_GIT_REPOSITORY");
    assert.strictEqual(task.error_detail.phase, "preparing_worktree");
    assert.strictEqual(task.error_detail.request_id, failed.request_id);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("agent startup failures are recorded in starting_agent with the same request_id", async () => {
  const root = mkdtempSync(join(tmpdir(), "mimo-p0-start-failure-"));
  const runtime = join(root, "runtime");
  const store = new TaskStore(runtime);
  const handler = createStartTaskHandler(config(root, runtime), store, {
    taskQueue: new TaskQueue(8),
    runningTasks: new RunningTaskRegistry(),
    runTask: () => { throw new Error("synthetic startup failure"); },
  });
  try {
    const started = await handler.handler(input(root));
    for (let i = 0; i < 50 && store.getTask(started.task_id)?.status !== "failed"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const task = store.getTask(started.task_id);
    assert.strictEqual(task.error_detail.code, "AGENT_START_FAILED");
    assert.strictEqual(task.error_detail.phase, "starting_agent");
    assert.strictEqual(task.error_detail.request_id, started.request_id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function config(root, runtimeDir) {
  return { mimoNodePath: process.execPath, mimoEntryPath: "unused.mjs", allowedRoots: [root], runtimeDir, agents: [] };
}

function input(workspacePath, extra = {}) {
  return {
    objective: "P0 task",
    workspace_path: workspacePath,
    editable_paths: ["src"],
    readonly_paths: [],
    acceptance_criteria: [],
    max_rounds: 5,
    runtime_timeout_seconds: 60,
    use_worktree: false,
    priority: 5,
    scope_mode: "strict",
    include_tests: "auto",
    repo_wide_confirmed: false,
    routing_mode: "auto",
    has_images: false,
    attachments: [],
    ...extra,
  };
}
