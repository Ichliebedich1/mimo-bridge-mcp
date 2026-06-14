import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testRuntimeDir = join(__dirname, "test-runtime");

describe("task-store", () => {
  let TaskStore;

  before(async () => {
    if (existsSync(testRuntimeDir)) {
      rmSync(testRuntimeDir, { recursive: true, force: true });
    }
    mkdirSync(testRuntimeDir, { recursive: true });

    const module = await import("../dist/services/task-store.js");
    TaskStore = module.TaskStore;
  });

  after(() => {
    if (existsSync(testRuntimeDir)) {
      rmSync(testRuntimeDir, { recursive: true, force: true });
    }
  });

  it("should create a task", () => {
    const store = new TaskStore(testRuntimeDir);

    const task = store.createTask({
      objective: "测试任务",
      workspace_path: "C:\\test",
      editable_paths: ["src"],
      readonly_paths: [],
      acceptance_criteria: ["测试通过"],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    assert.ok(task.task_id, "任务应该有 task_id");
    assert.strictEqual(task.status, "queued");
    assert.strictEqual(task.config.objective, "测试任务");
  });

  it("should get a task", () => {
    const store = new TaskStore(testRuntimeDir);

    const task = store.createTask({
      objective: "测试任务2",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    const retrieved = store.getTask(task.task_id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.task_id, task.task_id);
    assert.strictEqual(retrieved.config.objective, "测试任务2");
  });

  it("should update task status", () => {
    const store = new TaskStore(testRuntimeDir);

    const task = store.createTask({
      objective: "测试任务3",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    const updated = store.updateTaskStatus(task.task_id, "running");
    assert.ok(updated);
    assert.strictEqual(updated.status, "running");
  });

  it("should update task session", () => {
    const store = new TaskStore(testRuntimeDir);

    const task = store.createTask({
      objective: "测试任务4",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    const updated = store.updateTaskSession(task.task_id, "ses_test123");
    assert.ok(updated);
    assert.strictEqual(updated.session_id, "ses_test123");
    assert.strictEqual(updated.current_round, 1);
  });

  it("should list tasks", () => {
    const store = new TaskStore(testRuntimeDir);

    store.createTask({
      objective: "任务A",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    store.createTask({
      objective: "任务B",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    const tasks = store.listTasks();
    assert.ok(tasks.length >= 2);
  });
});
