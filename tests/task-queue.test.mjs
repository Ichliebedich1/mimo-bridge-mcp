import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-task-queue");

describe("task-queue", () => {
  let TaskQueue;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    const module = await import("../dist/services/task-queue.js");
    TaskQueue = module.TaskQueue;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should enqueue and process tasks", async () => {
    const queue = new TaskQueue(1);
    const executed = [];

    queue.enqueue({
      taskId: "task_1",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => { executed.push("task_1"); },
      cancel: () => {},
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(executed, ["task_1"]);
  });

  it("should queue tasks when max concurrent reached", async () => {
    const queue = new TaskQueue(1);
    const executed = [];

    queue.enqueue({
      taskId: "task_1",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_1");
        await new Promise((r) => setTimeout(r, 200));
      },
      cancel: () => {},
    });

    queue.enqueue({
      taskId: "task_2",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => { executed.push("task_2"); },
      cancel: () => {},
    });

    assert.deepStrictEqual(executed, ["task_1"]);
    assert.strictEqual(queue.size, 1);

    await new Promise((r) => setTimeout(r, 300));
    assert.deepStrictEqual(executed, ["task_1", "task_2"]);
    assert.strictEqual(queue.size, 0);
  });

  it("should prioritize higher priority tasks", async () => {
    const queue = new TaskQueue(1);
    const executed = [];

    queue.enqueue({
      taskId: "task_low",
      priority: 1,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_low");
        await new Promise((r) => setTimeout(r, 200));
      },
      cancel: () => {},
    });

    queue.enqueue({
      taskId: "task_high",
      priority: 10,
      enqueuedAt: Date.now(),
      execute: async () => { executed.push("task_high"); },
      cancel: () => {},
    });

    queue.enqueue({
      taskId: "task_medium",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => { executed.push("task_medium"); },
      cancel: () => {},
    });

    assert.strictEqual(queue.size, 2);

    await new Promise((r) => setTimeout(r, 300));
    assert.deepStrictEqual(executed, ["task_low", "task_high", "task_medium"]);
  });

  it("should cancel queued task", async () => {
    const queue = new TaskQueue(1);
    const cancelled = [];

    queue.enqueue({
      taskId: "task_1",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 200));
      },
      cancel: () => { cancelled.push("task_1"); },
    });

    queue.enqueue({
      taskId: "task_2",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {},
      cancel: () => { cancelled.push("task_2"); },
    });

    const result = queue.cancel("task_2");
    assert.strictEqual(result, true);
    assert.strictEqual(queue.size, 0);
    assert.deepStrictEqual(cancelled, ["task_2"]);
  });

  it("should return false when cancelling non-existent task", () => {
    const queue = new TaskQueue(1);
    const result = queue.cancel("task_nonexistent");
    assert.strictEqual(result, false);
  });

  it("should cancel all queued tasks", async () => {
    const queue = new TaskQueue(1);
    const cancelled = [];

    queue.enqueue({
      taskId: "task_1",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 200));
      },
      cancel: () => { cancelled.push("task_1"); },
    });

    queue.enqueue({
      taskId: "task_2",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {},
      cancel: () => { cancelled.push("task_2"); },
    });

    queue.enqueue({
      taskId: "task_3",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {},
      cancel: () => { cancelled.push("task_3"); },
    });

    queue.cancelAll();
    assert.strictEqual(queue.size, 0);
    assert.deepStrictEqual(cancelled, ["task_2", "task_3"]);
  });

  it("should get queued tasks info", async () => {
    const queue = new TaskQueue(1);

    queue.enqueue({
      taskId: "task_1",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 200));
      },
      cancel: () => {},
    });

    queue.enqueue({
      taskId: "task_2",
      priority: 10,
      enqueuedAt: Date.now(),
      execute: async () => {},
      cancel: () => {},
    });

    const tasks = queue.getQueuedTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].taskId, "task_2");
    assert.strictEqual(tasks[0].priority, 10);
  });

  it("should report correct status", async () => {
    const queue = new TaskQueue(1);

    assert.strictEqual(queue.running, 0);
    assert.strictEqual(queue.size, 0);
    assert.strictEqual(queue.isIdle, true);

    queue.enqueue({
      taskId: "task_1",
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 200));
      },
      cancel: () => {},
    });

    assert.strictEqual(queue.running, 1);
    assert.strictEqual(queue.size, 0);
    assert.strictEqual(queue.isIdle, false);

    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(queue.running, 0);
    assert.strictEqual(queue.isIdle, true);
  });

  it("should run different agents in parallel when editable paths do not overlap", async () => {
    const queue = new TaskQueue(2);
    const executed = [];
    let releaseFirst;

    queue.enqueue({
      taskId: "task_mimo",
      agentId: "mimo",
      workspacePath: testDir,
      editablePaths: ["src/a"],
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_mimo");
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      },
      cancel: () => {},
    });

    const startedImmediately = queue.enqueue({
      taskId: "task_reasonix",
      agentId: "reasonix-tui",
      workspacePath: testDir,
      editablePaths: ["src/b"],
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_reasonix");
      },
      cancel: () => {},
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(startedImmediately, true);
    assert.deepStrictEqual(executed, ["task_mimo", "task_reasonix"]);
    assert.strictEqual(queue.running, 1);
    releaseFirst();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("should run same-agent tasks in parallel when editable paths do not overlap", async () => {
    const queue = new TaskQueue(2);
    const executed = [];
    let releaseFirst;

    queue.enqueue({
      taskId: "task_one",
      agentId: "mimo",
      workspacePath: testDir,
      editablePaths: ["src/a"],
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_one");
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      },
      cancel: () => {},
    });

    const startedImmediately = queue.enqueue({
      taskId: "task_two",
      agentId: "mimo",
      workspacePath: testDir,
      editablePaths: ["src/b"],
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_two");
      },
      cancel: () => {},
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(startedImmediately, true);
    assert.deepStrictEqual(executed, ["task_one", "task_two"]);
    assert.strictEqual(queue.size, 0);
    assert.strictEqual(queue.running, 1);
    releaseFirst();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("should queue overlapping editable paths across agents, including the same agent", async () => {
    const queue = new TaskQueue(2);
    const executed = [];
    let releaseFirst;

    queue.enqueue({
      taskId: "task_parent",
      agentId: "mimo",
      workspacePath: testDir,
      editablePaths: ["src"],
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_parent");
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      },
      cancel: () => {},
    });

    const startedImmediately = queue.enqueue({
      taskId: "task_child",
      agentId: "mimo",
      workspacePath: testDir,
      editablePaths: ["src/components"],
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_child");
      },
      cancel: () => {},
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(startedImmediately, false);
    assert.deepStrictEqual(executed, ["task_parent"]);
    assert.strictEqual(queue.size, 1);
    releaseFirst();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(executed, ["task_parent", "task_child"]);
  });

  it("should queue tasks with unknown agent metadata conservatively", async () => {
    const queue = new TaskQueue(2);
    const executed = [];
    let releaseFirst;

    queue.enqueue({
      taskId: "task_unknown_agent",
      workspacePath: testDir,
      editablePaths: ["src/a"],
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_unknown_agent");
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      },
      cancel: () => {},
    });

    const startedImmediately = queue.enqueue({
      taskId: "task_known_agent",
      agentId: "reasonix-tui",
      workspacePath: testDir,
      editablePaths: ["src/b"],
      priority: 5,
      enqueuedAt: Date.now(),
      execute: async () => {
        executed.push("task_known_agent");
      },
      cancel: () => {},
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(startedImmediately, false);
    assert.deepStrictEqual(executed, ["task_unknown_agent"]);
    releaseFirst();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(executed, ["task_unknown_agent", "task_known_agent"]);
  });
});

describe("concurrent start/reply with queue", () => {
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

    const handler = createStartTaskHandler(config, store, {
      runningTasks,
      taskQueue,
    });

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

  it("should allow get/list tasks while write task is running", async () => {
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

    const startHandler = createStartTaskHandler(config, store, {
      runningTasks,
      taskQueue,
    });

    const startResult = await startHandler.handler({
      objective: "写任务",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.ok(startResult.task_id);

    const getModule = await import("../dist/tools/get-task.js");
    const getHandler = getModule.createGetTaskHandler(store);

    const getResult = await getHandler.handler({ task_id: startResult.task_id });
    assert.ok(getResult.task_id);

    const listModule = await import("../dist/tools/list-tasks.js");
    const listHandler = listModule.createListTasksHandler(store);

    const listResult = await listHandler.handler({});
    assert.ok(Array.isArray(listResult.tasks));

    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });

  it("should cancel queued task", async () => {
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

    const handler = createStartTaskHandler(config, store, {
      runningTasks,
      taskQueue,
    });

    const result1 = await handler.handler({
      objective: "第一个任务",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    const result2 = await handler.handler({
      objective: "第二个任务",
      workspace_path: subDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
    });

    assert.strictEqual(result2.status, "queued");

    const cancelModule = await import("../dist/tools/cancel-task.js");
    const cancelHandler = cancelModule.createCancelTaskHandler(store, { runningTasks, taskQueue });

    const cancelResult = await cancelHandler.handler({ task_id: result2.task_id });
    assert.ok(cancelResult.status === "cancelled" || cancelResult.task_id);

    const task = store.getTask(result2.task_id);
    assert.strictEqual(task.status, "cancelled");

    runningTasks.cancelAll();
    taskQueue.cancelAll();
  });
});
