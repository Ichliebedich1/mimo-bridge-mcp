import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-finish-task");

describe("finish-task", () => {
  let TaskStore;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    const taskStoreModule = await import("../dist/services/task-store.js");
    TaskStore = taskStoreModule.TaskStore;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should accept a review task", async () => {
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

    store.updateTaskStatus(task.task_id, "review");

    const { createFinishTaskHandler } = await import("../dist/tools/finish-task.js");
    const handler = createFinishTaskHandler(store);

    const result = await handler.handler({ task_id: task.task_id, status: "accepted" });

    assert.strictEqual(result.status, "accepted");
    assert.strictEqual(result.task_id, task.task_id);

    const updatedTask = store.getTask(task.task_id);
    assert.strictEqual(updatedTask.status, "accepted");
  });

  it("should abandon a review task", async () => {
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

    store.updateTaskStatus(task.task_id, "review");

    const { createFinishTaskHandler } = await import("../dist/tools/finish-task.js");
    const handler = createFinishTaskHandler(store);

    const result = await handler.handler({ task_id: task.task_id, status: "abandoned" });

    assert.strictEqual(result.status, "abandoned");
    assert.strictEqual(result.task_id, task.task_id);

    const updatedTask = store.getTask(task.task_id);
    assert.strictEqual(updatedTask.status, "abandoned");
  });

  it("should abandon failed and cancelled terminal tasks for cleanup flow", async () => {
    const store = new TaskStore(testDir);

    const failedTask = store.createTask({
      objective: "失败任务清理",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });
    const cancelledTask = store.createTask({
      objective: "取消任务清理",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    store.updateTaskStatus(failedTask.task_id, "failed");
    store.updateTaskStatus(cancelledTask.task_id, "cancelled");

    const { createFinishTaskHandler } = await import("../dist/tools/finish-task.js");
    const handler = createFinishTaskHandler(store);

    const failedResult = await handler.handler({ task_id: failedTask.task_id, status: "abandoned" });
    const cancelledResult = await handler.handler({ task_id: cancelledTask.task_id, status: "abandoned" });

    assert.strictEqual(failedResult.status, "abandoned");
    assert.strictEqual(cancelledResult.status, "abandoned");
    assert.strictEqual(store.getTask(failedTask.task_id).status, "abandoned");
    assert.strictEqual(store.getTask(cancelledTask.task_id).status, "abandoned");
  });

  it("should still reject accepting failed tasks", async () => {
    const store = new TaskStore(testDir);

    const task = store.createTask({
      objective: "失败任务不能验收",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    store.updateTaskStatus(task.task_id, "failed");

    const { createFinishTaskHandler } = await import("../dist/tools/finish-task.js");
    const handler = createFinishTaskHandler(store);

    const result = await handler.handler({ task_id: task.task_id, status: "accepted" });

    assert.ok(result.error);
    assert.ok(result.error.includes("不允许完成"));
    assert.strictEqual(store.getTask(task.task_id).status, "failed");
  });

  it("should reject finishing non-existent task", async () => {
    const store = new TaskStore(testDir);

    const { createFinishTaskHandler } = await import("../dist/tools/finish-task.js");
    const handler = createFinishTaskHandler(store);

    const result = await handler.handler({ task_id: "task_nonexistent", status: "accepted" });

    assert.ok(result.error);
    assert.ok(result.error.includes("不存在"));
  });

  it("should reject finishing non-review task", async () => {
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

    const { createFinishTaskHandler } = await import("../dist/tools/finish-task.js");
    const handler = createFinishTaskHandler(store);

    const result = await handler.handler({ task_id: task.task_id, status: "accepted" });

    assert.ok(result.error);
    assert.ok(result.error.includes("不允许完成"));
  });
});
