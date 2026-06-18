import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-reply-max-rounds");

describe("reply-task max_rounds boundary at tool layer", () => {
  let TaskStore;
  let createReplyTaskHandler;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    const taskStoreModule = await import("../dist/services/task-store.js");
    TaskStore = taskStoreModule.TaskStore;

    const replyModule = await import("../dist/tools/reply-task.js");
    createReplyTaskHandler = replyModule.createReplyTaskHandler;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should reject reply when max_rounds=1 and round already completed", async () => {
    const subDir = join(testDir, "test1");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);

    const task = store.createTask({
      objective: "测试任务",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 900,
    });

    store.updateTaskStatus(task.task_id, "review");
    store.updateTaskSession(task.task_id, "ses_test");

    const config = {
      mimoNodePath: process.execPath,
      mimoEntryPath: "fake",
      allowedRoots: ["C:\\test"],
      runtimeDir: subDir,
    };

    const handler = createReplyTaskHandler(config, store);

    store.updateTaskStatus(task.task_id, "review");

    const result = await handler.handler({
      task_id: task.task_id,
      message: "继续",
    });

    assert.ok(result.error);
    assert.ok(result.error.includes("最大沟通轮数"));
  });

  it("should reject reply when max_rounds=2 and both rounds completed", async () => {
    const subDir = join(testDir, "test2");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);

    let task = store.createTask({
      objective: "测试任务",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 2,
      runtime_timeout_seconds: 900,
    });

    store.updateTaskStatus(task.task_id, "review");
    task = store.updateTaskSession(task.task_id, "ses_test");
    store.updateTaskStatus(task.task_id, "review");
    task = store.updateTaskSession(task.task_id, "ses_test");

    assert.strictEqual(task.current_round, 3);
    assert.ok(task.current_round > task.config.max_rounds);

    const config = {
      mimoNodePath: process.execPath,
      mimoEntryPath: "fake",
      allowedRoots: ["C:\\test"],
      runtimeDir: subDir,
    };

    const handler = createReplyTaskHandler(config, store);

    store.updateTaskStatus(task.task_id, "review");

    const result = await handler.handler({
      task_id: task.task_id,
      message: "继续",
    });

    assert.ok(result.error);
    assert.ok(result.error.includes("最大沟通轮数"));
  });

  it("should reject reply when max_rounds=5 and all 5 rounds completed", async () => {
    const subDir = join(testDir, "test3");
    mkdirSync(subDir, { recursive: true });
    const store = new TaskStore(subDir);

    let task = store.createTask({
      objective: "测试任务",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    for (let i = 0; i < 5; i++) {
      store.updateTaskStatus(task.task_id, "review");
      task = store.updateTaskSession(task.task_id, "ses_test");
    }

    assert.strictEqual(task.current_round, 6);
    assert.ok(task.current_round > task.config.max_rounds);

    const config = {
      mimoNodePath: process.execPath,
      mimoEntryPath: "fake",
      allowedRoots: ["C:\\test"],
      runtimeDir: subDir,
    };

    const handler = createReplyTaskHandler(config, store);

    store.updateTaskStatus(task.task_id, "review");

    const result = await handler.handler({
      task_id: task.task_id,
      message: "继续",
    });

    assert.ok(result.error);
    assert.ok(result.error.includes("最大沟通轮数"));
  });
});
