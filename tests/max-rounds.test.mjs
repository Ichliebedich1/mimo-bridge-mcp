import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-max-rounds");

describe("max-rounds boundary", () => {
  let TaskStore;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    const module = await import("../dist/services/task-store.js");
    TaskStore = module.TaskStore;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("max_rounds=1 should only allow first round", () => {
    const store = new TaskStore(testDir);

    const task = store.createTask({
      objective: "测试任务",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 900,
    });

    assert.strictEqual(task.current_round, 1);
    assert.strictEqual(task.config.max_rounds, 1);

    const afterFirstRound = store.updateTaskSession(task.task_id, "ses_test");
    assert.strictEqual(afterFirstRound.current_round, 2);
    assert.ok(afterFirstRound.current_round > afterFirstRound.config.max_rounds);
  });

  it("max_rounds=2 should allow first and second round", () => {
    const store = new TaskStore(testDir);

    const task = store.createTask({
      objective: "测试任务",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 2,
      runtime_timeout_seconds: 900,
    });

    assert.strictEqual(task.current_round, 1);

    const afterFirstRound = store.updateTaskSession(task.task_id, "ses_test");
    assert.strictEqual(afterFirstRound.current_round, 2);
    assert.ok(afterFirstRound.current_round <= afterFirstRound.config.max_rounds);

    const afterSecondRound = store.updateTaskSession(task.task_id, "ses_test");
    assert.strictEqual(afterSecondRound.current_round, 3);
    assert.ok(afterSecondRound.current_round > afterSecondRound.config.max_rounds);
  });

  it("max_rounds=5 should allow five rounds", () => {
    const store = new TaskStore(testDir);

    let task = store.createTask({
      objective: "测试任务",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    for (let i = 1; i <= 5; i++) {
      assert.strictEqual(task.current_round, i);
      task = store.updateTaskSession(task.task_id, "ses_test");
    }

    assert.strictEqual(task.current_round, 6);
    assert.ok(task.current_round > task.config.max_rounds);
  });

  it("error field should be persisted", () => {
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

    store.updateTaskResult(task.task_id, { error: "测试错误" });

    const retrieved = store.getTask(task.task_id);
    assert.strictEqual(retrieved.error, "测试错误");
  });
});
