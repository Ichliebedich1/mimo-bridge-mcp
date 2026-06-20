import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-concurrent-reject");

describe("shared concurrency with queue", () => {
  let TaskStore;
  let createStartTaskHandler;
  let createReplyTaskHandler;
  let createCancelTaskHandler;
  let RunningTaskRegistry;
  let TaskQueue;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "briefs"), { recursive: true });
    mkdirSync(join(testDir, "logs"), { recursive: true });

    const taskStoreModule = await import("../dist/services/task-store.js");
    TaskStore = taskStoreModule.TaskStore;

    const startModule = await import("../dist/tools/start-task.js");
    createStartTaskHandler = startModule.createStartTaskHandler;

    const replyModule = await import("../dist/tools/reply-task.js");
    createReplyTaskHandler = replyModule.createReplyTaskHandler;

    const cancelModule = await import("../dist/tools/cancel-task.js");
    createCancelTaskHandler = cancelModule.createCancelTaskHandler;

    const runningTasksModule = await import("../dist/services/running-tasks.js");
    RunningTaskRegistry = runningTasksModule.RunningTaskRegistry;

    const taskQueueModule = await import("../dist/services/task-queue.js");
    TaskQueue = taskQueueModule.TaskQueue;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should not invoke a queued runner until the active runner completes", async () => {
    const subDir = join(testDir, "serialized-runners");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);
    const runningTasks = new RunningTaskRegistry();
    const taskQueue = new TaskQueue(1);
    const completions = [];
    let runnerInvocations = 0;

    const config = {
      mimoNodePath: "unused-node",
      mimoEntryPath: "unused-entry",
      allowedRoots: [subDir],
      runtimeDir: subDir,
    };
    const handler = createStartTaskHandler(config, store, {
      runningTasks,
      taskQueue,
      runTask: (_options, onComplete) => {
        runnerInvocations += 1;
        completions.push(onComplete);
        return { process: {}, cancel: () => {} };
      },
    });

    const first = await handler.handler({
      objective: "first controlled task",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });
    const second = await handler.handler({
      objective: "second controlled task",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.strictEqual(first.status, "running");
    assert.strictEqual(second.status, "queued");
    assert.strictEqual(runnerInvocations, 1);

    completions[0]({
      task_id: first.task_id,
      agent: "mimo",
      session_id: "ses_first",
      status: "review",
      summary: "done",
      modified_files: [],
      test_results: "",
      questions: [],
      issues: [],
      raw_log_path: "",
      stderr_log_path: "",
      error: null,
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(runnerInvocations, 2);
    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });

  it("should keep the queue occupied until a queued reply runner completes", async () => {
    const subDir = join(testDir, "serialized-reply");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);
    const runningTasks = new RunningTaskRegistry();
    const taskQueue = new TaskQueue(1);
    const completions = [];
    let runnerInvocations = 0;
    const runTask = (_options, onComplete) => {
      runnerInvocations += 1;
      completions.push(onComplete);
      return { process: {}, cancel: () => {} };
    };
    const config = {
      mimoNodePath: "unused-node",
      mimoEntryPath: "unused-entry",
      allowedRoots: [subDir],
      runtimeDir: subDir,
    };
    const replyTarget = store.createTask({
      objective: "reply target",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });
    store.updateTaskStatus(replyTarget.task_id, "review");
    store.updateTaskSession(replyTarget.task_id, "ses_reply");

    const startHandler = createStartTaskHandler(config, store, { runningTasks, taskQueue, runTask });
    const replyHandler = createReplyTaskHandler(config, store, { runningTasks, taskQueue, runTask });
    const first = await startHandler.handler({
      objective: "first runner",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });
    const reply = await replyHandler.handler({ task_id: replyTarget.task_id, message: "continue" });
    const third = await startHandler.handler({
      objective: "third runner",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.strictEqual(first.status, "running");
    assert.strictEqual(reply.status, "queued");
    assert.strictEqual(third.status, "queued");
    assert.strictEqual(runnerInvocations, 1);

    completions[0]({
      task_id: first.task_id,
      agent: "mimo",
      session_id: "ses_first",
      status: "review",
      summary: "done",
      modified_files: [],
      test_results: "",
      questions: [],
      issues: [],
      raw_log_path: "",
      stderr_log_path: "",
      error: null,
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(runnerInvocations, 2);
    completions[1]({
      task_id: replyTarget.task_id,
      agent: "mimo",
      session_id: "ses_reply",
      status: "review",
      summary: "reply done",
      modified_files: [],
      test_results: "",
      questions: [],
      issues: [],
      raw_log_path: "",
      stderr_log_path: "",
      error: null,
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(runnerInvocations, 3);
    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });

  it("should reject a duplicate queued reply without overwriting its brief", async () => {
    const subDir = join(testDir, "duplicate-reply");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);
    const runningTasks = new RunningTaskRegistry();
    const taskQueue = new TaskQueue(1);
    const runTask = () => ({ process: {}, cancel: () => {} });
    const config = {
      mimoNodePath: "unused-node",
      mimoEntryPath: "unused-entry",
      allowedRoots: [subDir],
      runtimeDir: subDir,
    };
    const replyTarget = store.createTask({
      objective: "reply target",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });
    store.updateTaskStatus(replyTarget.task_id, "review");
    store.updateTaskSession(replyTarget.task_id, "ses_reply");

    const startHandler = createStartTaskHandler(config, store, { runningTasks, taskQueue, runTask });
    const replyHandler = createReplyTaskHandler(config, store, { runningTasks, taskQueue, runTask });
    await startHandler.handler({
      objective: "active task",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    const firstReply = await replyHandler.handler({ task_id: replyTarget.task_id, message: "first reply" });
    const briefPath = store.getBriefPath(replyTarget.task_id, store.getTask(replyTarget.task_id).current_round);
    const firstBrief = readFileSync(briefPath, "utf-8");
    const duplicateReply = await replyHandler.handler({ task_id: replyTarget.task_id, message: "second reply" });

    assert.strictEqual(firstReply.status, "queued");
    assert.match(duplicateReply.error, /已在队列/);
    assert.strictEqual(taskQueue.size, 1);
    assert.strictEqual(readFileSync(briefPath, "utf-8"), firstBrief);
    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });

  it("should remove a queued task Worktree and branch when cancelled", async () => {
    const subDir = join(testDir, "cancel-worktree");
    const repoDir = join(subDir, "repo");
    const runtimeDir = join(subDir, "runtime");
    mkdirSync(repoDir, { recursive: true });
    execFileSync("git", ["init", "-b", "master"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    writeFileSync(join(repoDir, "README.md"), "fixture\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir });

    const store = new TaskStore(runtimeDir);
    const runningTasks = new RunningTaskRegistry();
    const taskQueue = new TaskQueue(1);
    const config = {
      mimoNodePath: "unused-node",
      mimoEntryPath: "unused-entry",
      allowedRoots: [repoDir],
      runtimeDir,
    };
    const handler = createStartTaskHandler(config, store, {
      runningTasks,
      taskQueue,
      runTask: () => ({ process: {}, cancel: () => {} }),
    });
    await handler.handler({
      objective: "active task",
      workspace_path: repoDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });
    const queued = await handler.handler({
      objective: "queued worktree task",
      workspace_path: repoDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      use_worktree: true,
    });
    const queuedTask = store.getTask(queued.task_id);
    const worktreePath = queuedTask.worktree.worktree_path;
    const branchName = queuedTask.worktree.branch_name;

    assert.strictEqual(queued.status, "queued");
    assert.strictEqual(existsSync(worktreePath), true);

    const cancelHandler = createCancelTaskHandler(store, { runningTasks, taskQueue });
    const cancelled = await cancelHandler.handler({ task_id: queued.task_id });

    assert.strictEqual(cancelled.status, "cancelled");
    assert.strictEqual(existsSync(worktreePath), false);
    assert.strictEqual(store.getTask(queued.task_id).worktree, null);
    assert.strictEqual(execFileSync("git", ["branch", "--list", branchName], { cwd: repoDir, encoding: "utf-8" }).trim(), "");
    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });

  it("should release the queue when the active runner is cancelled", async () => {
    const subDir = join(testDir, "cancel-active");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);
    const runningTasks = new RunningTaskRegistry();
    const taskQueue = new TaskQueue(1);
    let runnerInvocations = 0;
    let runnerCancellations = 0;
    const config = {
      mimoNodePath: "unused-node",
      mimoEntryPath: "unused-entry",
      allowedRoots: [subDir],
      runtimeDir: subDir,
    };
    const handler = createStartTaskHandler(config, store, {
      runningTasks,
      taskQueue,
      runTask: () => {
        runnerInvocations += 1;
        return { process: {}, cancel: () => { runnerCancellations += 1; } };
      },
    });
    const first = await handler.handler({
      objective: "active task",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });
    const second = await handler.handler({
      objective: "queued task",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });
    const cancelHandler = createCancelTaskHandler(store, { runningTasks, taskQueue });

    assert.strictEqual(second.status, "queued");
    await cancelHandler.handler({ task_id: first.task_id });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(runnerCancellations, 1);
    assert.strictEqual(runnerInvocations, 2);
    assert.strictEqual(store.getTask(first.task_id).status, "cancelled");
    assert.strictEqual(store.getTask(second.task_id).status, "running");
    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });

  it("should release the queue when the active runner fails", async () => {
    const subDir = join(testDir, "fail-active");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);
    const runningTasks = new RunningTaskRegistry();
    const taskQueue = new TaskQueue(1);
    const failures = [];
    let runnerInvocations = 0;
    const config = {
      mimoNodePath: "unused-node",
      mimoEntryPath: "unused-entry",
      allowedRoots: [subDir],
      runtimeDir: subDir,
    };
    const handler = createStartTaskHandler(config, store, {
      runningTasks,
      taskQueue,
      runTask: (_options, _onComplete, onError) => {
        runnerInvocations += 1;
        failures.push(onError);
        return { process: {}, cancel: () => {} };
      },
    });
    const first = await handler.handler({
      objective: "failing task",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });
    const second = await handler.handler({
      objective: "queued after failure",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.strictEqual(second.status, "queued");
    failures[0]("runner failed");
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(runnerInvocations, 2);
    assert.strictEqual(store.getTask(first.task_id).status, "failed");
    assert.strictEqual(store.getTask(second.task_id).status, "running");
    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });

  it("should queue start_task when another task is running", async () => {
    const subDir = join(testDir, "test1");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);
    const runningTasks = new RunningTaskRegistry();
    const taskQueue = new TaskQueue(1);

    const config = {
      mimoNodePath: process.execPath,
      mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
      allowedRoots: [subDir],
      runtimeDir: subDir,
    };

    writeFileSync(join(subDir, "test.txt"), "test content");

    const handler = createStartTaskHandler(config, store, { runningTasks, taskQueue });

    const result1 = await handler.handler({
      objective: "第一个任务",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.ok(result1.task_id);
    assert.strictEqual(result1.status, "running");

    const result2 = await handler.handler({
      objective: "第二个任务",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.ok(result2.task_id);
    assert.strictEqual(result2.status, "queued");

    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });

  it("should queue reply_task when another task is running", async () => {
    const subDir = join(testDir, "test2");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);
    const runningTasks = new RunningTaskRegistry();
    const taskQueue = new TaskQueue(1);

    const config = {
      mimoNodePath: process.execPath,
      mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
      allowedRoots: [subDir],
      runtimeDir: subDir,
    };

    writeFileSync(join(subDir, "test.txt"), "test content");

    const task = store.createTask({
      objective: "测试任务",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    store.updateTaskStatus(task.task_id, "review");
    store.updateTaskSession(task.task_id, "ses_test");

    const startHandler = createStartTaskHandler(config, store, { runningTasks, taskQueue });
    const startResult = await startHandler.handler({
      objective: "另一个任务",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.ok(startResult.task_id);

    const replyHandler = createReplyTaskHandler(config, store, { runningTasks, taskQueue });
    const replyResult = await replyHandler.handler({
      task_id: task.task_id,
      message: "继续",
    });

    assert.ok(replyResult.task_id);
    assert.strictEqual(replyResult.status, "queued");

    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });

  it("should allow start_task after previous task completes", async () => {
    const subDir = join(testDir, "test3");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);
    const runningTasks = new RunningTaskRegistry();
    const taskQueue = new TaskQueue(1);

    const config = {
      mimoNodePath: process.execPath,
      mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
      allowedRoots: [subDir],
      runtimeDir: subDir,
    };

    writeFileSync(join(subDir, "test.txt"), "test content");

    const handler = createStartTaskHandler(config, store, { runningTasks, taskQueue });

    const result1 = await handler.handler({
      objective: "第一个任务",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.ok(result1.task_id);

    await new Promise((r) => setTimeout(r, 500));

    const result2 = await handler.handler({
      objective: "第二个任务",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.ok(result2.task_id);
    assert.strictEqual(result2.status, "running");

    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });
});
