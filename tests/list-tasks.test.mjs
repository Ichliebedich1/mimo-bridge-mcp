import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-list-tasks");

describe("list-tasks", () => {
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

  it("should list tasks", async () => {
    const store = new TaskStore(testDir);

    store.createTask({
      objective: "任务1",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    store.createTask({
      objective: "任务2",
      workspace_path: "C:\\test",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    const { createListTasksHandler } = await import("../dist/tools/list-tasks.js");
    const handler = createListTasksHandler(store);

    const result = await handler.handler({ limit: 10 });

    assert.ok(result.tasks);
    assert.ok(result.tasks.length >= 2);
    assert.strictEqual(result.tasks[0].agent, "mimo");
  });

  it("should respect limit parameter", async () => {
    const store = new TaskStore(testDir);

    for (let i = 0; i < 5; i++) {
      store.createTask({
        objective: `任务${i}`,
        workspace_path: "C:\\test",
        editable_paths: [],
        readonly_paths: [],
        acceptance_criteria: [],
        max_rounds: 5,
        runtime_timeout_seconds: 900,
      });
    }

    const { createListTasksHandler } = await import("../dist/tools/list-tasks.js");
    const handler = createListTasksHandler(store);

    const result = await handler.handler({ limit: 3 });

    assert.ok(result.tasks);
    assert.ok(result.tasks.length <= 3);
  });

  it("should return empty list when no tasks", async () => {
    const emptyDir = join(testDir, "empty");
    mkdirSync(emptyDir, { recursive: true });

    const store = new TaskStore(emptyDir);

    const { createListTasksHandler } = await import("../dist/tools/list-tasks.js");
    const handler = createListTasksHandler(store);

    const result = await handler.handler({ limit: 10 });

    assert.ok(result.tasks);
    assert.strictEqual(result.tasks.length, 0);
  });
});
