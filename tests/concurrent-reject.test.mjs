import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
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
