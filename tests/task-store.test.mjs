import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync, writeFileSync, symlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const readTombstones = (runtimeDir) => {
  const tombstonePath = join(runtimeDir, "deleted-mimo-sessions.json");
  if (!existsSync(tombstonePath)) return null;
  return JSON.parse(readFileSync(tombstonePath, "utf-8"));
};

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

  it("should create a task with current_round = 1", () => {
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

    assert.strictEqual(task.current_round, 1);
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

  it("should reject invalid task_id with path traversal", () => {
    const store = new TaskStore(testRuntimeDir);

    const result = store.getTask("../secret");
    assert.strictEqual(result, null);
  });

  it("should reject task_id with special characters", () => {
    const store = new TaskStore(testRuntimeDir);

    const result = store.getTask("task_../test");
    assert.strictEqual(result, null);
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

  it("should update task session and increment round", () => {
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

    assert.strictEqual(task.current_round, 1);

    const updated = store.updateTaskSession(task.task_id, "ses_test123");
    assert.ok(updated);
    assert.strictEqual(updated.session_id, "ses_test123");
    assert.strictEqual(updated.current_round, 2);
  });

  it("should perform atomic save without .tmp files", () => {
    const store = new TaskStore(testRuntimeDir);

    const task = store.createTask({
      objective: "原子保存测试",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    const tasksDir = join(testRuntimeDir, "tasks");
    const tmpFile = join(tasksDir, `${task.task_id}.json.tmp`);

    assert.ok(!existsSync(tmpFile), "不应存在 .tmp 文件");
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

  it("should write tombstone with session_id on delete", () => {
    const store = new TaskStore(testRuntimeDir);
    const task = store.createTask({
      objective: "tombstone test",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });
    store.updateTaskStatus(task.task_id, "accepted");
    store.updateTaskSession(task.task_id, "ses_abc123");

    const deleted = store.deleteTask(task.task_id);
    assert.strictEqual(deleted, true);

    const tombstoneFile = readTombstones(testRuntimeDir);
    assert.ok(tombstoneFile);
    assert.strictEqual(tombstoneFile.version, 1);
    const entry = tombstoneFile.sessions.find((s) => s.task_id === task.task_id);
    assert.ok(entry);
    assert.strictEqual(entry.session_id, "ses_abc123");
    assert.ok(entry.deleted_at);
  });

  it("should write tombstone with null session_id on delete", () => {
    const store = new TaskStore(testRuntimeDir);
    const task = store.createTask({
      objective: "tombstone null session test",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });
    store.updateTaskStatus(task.task_id, "cancelled");

    const deleted = store.deleteTask(task.task_id);
    assert.strictEqual(deleted, true);

    const tombstoneFile = readTombstones(testRuntimeDir);
    assert.ok(tombstoneFile);
    const entry = tombstoneFile.sessions.find((s) => s.task_id === task.task_id);
    assert.ok(entry);
    assert.strictEqual(entry.session_id, null);
    assert.ok(entry.deleted_at);
  });

  it("should deduplicate tombstone entries by task_id", () => {
    const store = new TaskStore(testRuntimeDir);
    const task = store.createTask({
      objective: "dedup test",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });
    store.updateTaskStatus(task.task_id, "failed");

    store.deleteTask(task.task_id);

    store.createTask({
      objective: "recreate",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });

    const tombstoneFile = readTombstones(testRuntimeDir);
    assert.ok(tombstoneFile);
    const entries = tombstoneFile.sessions.filter((s) => s.task_id === task.task_id);
    assert.strictEqual(entries.length, 1);
  });

  it("should bound tombstone entries to 1000", () => {
    const store = new TaskStore(testRuntimeDir);
    const tombstonePath = join(testRuntimeDir, "deleted-mimo-sessions.json");
    const existing = {
      version: 1,
      sessions: Array.from({ length: 1000 }, (_, i) => ({
        task_id: `task_${String(i).padStart(12, "0")}`,
        session_id: null,
        deleted_at: "2025-01-01T00:00:00.000Z",
      })),
    };
    writeFileSync(tombstonePath, JSON.stringify(existing), "utf-8");

    const task = store.createTask({
      objective: "bounded test",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    store.updateTaskStatus(task.task_id, "accepted");
    store.deleteTask(task.task_id);

    const tombstoneFile = readTombstones(testRuntimeDir);
    assert.ok(tombstoneFile);
    assert.strictEqual(tombstoneFile.sessions.length, 1000);
    assert.strictEqual(tombstoneFile.sessions[999].task_id, task.task_id);
  });
});
