import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { globalRunningTasks } from "../dist/services/running-tasks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("running-tasks", () => {
  it("should track running tasks", () => {
    const registry = globalRunningTasks;

    assert.strictEqual(registry.size, 0);
    assert.strictEqual(registry.hasAny(), false);

    registry.register("task_001", () => {});
    assert.strictEqual(registry.size, 1);
    assert.strictEqual(registry.hasAny(), true);
    assert.strictEqual(registry.has("task_001"), true);

    registry.unregister("task_001");
    assert.strictEqual(registry.size, 0);
    assert.strictEqual(registry.hasAny(), false);
  });

  it("should cancel specific task", () => {
    const registry = globalRunningTasks;
    let cancelled = false;

    registry.register("task_002", () => { cancelled = true; });
    assert.strictEqual(registry.cancel("task_002"), true);
    assert.strictEqual(cancelled, true);
    assert.strictEqual(registry.size, 0);
  });

  it("should return false when cancelling non-existent task", () => {
    const registry = globalRunningTasks;
    assert.strictEqual(registry.cancel("task_999"), false);
  });

  it("should cancel all tasks", () => {
    const registry = globalRunningTasks;
    let cancelCount = 0;

    registry.register("task_003", () => { cancelCount++; });
    registry.register("task_004", () => { cancelCount++; });

    registry.cancelAll();
    assert.strictEqual(cancelCount, 2);
    assert.strictEqual(registry.size, 0);
  });
});
