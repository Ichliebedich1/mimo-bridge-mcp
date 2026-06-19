import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-cancel-task");

describe("cancel-task", () => {
  let TaskStore;
  let RunningTaskRegistry;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    const taskStoreModule = await import("../dist/services/task-store.js");
    TaskStore = taskStoreModule.TaskStore;

    const runningTasksModule = await import("../dist/services/running-tasks.js");
    RunningTaskRegistry = runningTasksModule.RunningTaskRegistry;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should cancel a running task", async () => {
    const store = new TaskStore(testDir);
    const registry = new RunningTaskRegistry();

    const task = store.createTask({
      objective: "测试任务",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    store.updateTaskStatus(task.task_id, "running");
    registry.register(task.task_id, () => {});

    const { createCancelTaskHandler } = await import("../dist/tools/cancel-task.js");
    const handler = createCancelTaskHandler(store);

    const result = await handler.handler({ task_id: task.task_id });

    assert.strictEqual(result.status, "cancelled");
    assert.strictEqual(result.task_id, task.task_id);

    const updatedTask = store.getTask(task.task_id);
    assert.strictEqual(updatedTask.status, "cancelled");
  });

  it("should reject cancelling non-existent task", async () => {
    const store = new TaskStore(testDir);

    const { createCancelTaskHandler } = await import("../dist/tools/cancel-task.js");
    const handler = createCancelTaskHandler(store);

    const result = await handler.handler({ task_id: "task_nonexistent" });

    assert.ok(result.error);
    assert.ok(result.error.includes("不存在"));
  });

  it("should reject cancelling non-running task", async () => {
    const store = new TaskStore(testDir);

    const task = store.createTask({
      objective: "测试任务",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    store.updateTaskStatus(task.task_id, "accepted");

    const { createCancelTaskHandler } = await import("../dist/tools/cancel-task.js");
    const handler = createCancelTaskHandler(store);

    const result = await handler.handler({ task_id: task.task_id });

    assert.ok(result.error);
    assert.ok(result.error.includes("不允许取消"));
  });
});
