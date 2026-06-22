import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskStore } from "../dist/services/task-store.js";
import { createWaitTaskHandler } from "../dist/tools/wait-task.js";

function createFixture() {
  const runtimeDir = mkdtempSync(join(tmpdir(), "wait-task-"));
  const store = new TaskStore(runtimeDir);
  const task = store.createTask({
    objective: "wait efficiently",
    workspace_path: runtimeDir,
    editable_paths: [],
    readonly_paths: [],
    acceptance_criteria: [],
    max_rounds: 3,
    runtime_timeout_seconds: 60,
  });
  return { runtimeDir, store, task, cleanup: () => rmSync(runtimeDir, { recursive: true, force: true }) };
}

test("mimo_wait_task returns terminal tasks immediately", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "review");
    const handler = createWaitTaskHandler(fixture.store);
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      timeout_seconds: 10,
      detail_level: "summary",
      max_chars: 1000,
    });
    assert.strictEqual(result.status, "review");
    assert.strictEqual(result.timed_out, false);
    assert.strictEqual(result.completed, true);
    assert.ok(result.waited_ms < 1000);
  } finally {
    fixture.cleanup();
  }
});

test("mimo_wait_task waits once and returns a bounded review package", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "running");
    let now = 0;
    const handler = createWaitTaskHandler(fixture.store, {
      now: () => now,
      pollIntervalMs: 100,
      sleep: async (milliseconds) => {
        now += milliseconds;
        fixture.store.updateTaskStatus(fixture.task.task_id, "review");
      },
    });
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      timeout_seconds: 10,
      detail_level: "review",
      max_chars: 2000,
    });
    assert.strictEqual(result.status, "review");
    assert.strictEqual(result.timed_out, false);
    assert.ok(result.review_package);
    assert.ok(JSON.stringify(result).length < 3000);
  } finally {
    fixture.cleanup();
  }
});

test("mimo_wait_task returns a minimal timeout response", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "running");
    let now = 0;
    const handler = createWaitTaskHandler(fixture.store, {
      now: () => now,
      pollIntervalMs: 1000,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      timeout_seconds: 1,
      detail_level: "review",
      max_chars: 8000,
    });
    assert.deepStrictEqual(result, {
      task_id: fixture.task.task_id,
      status: "running",
      completed: false,
      timed_out: true,
      waited_ms: 1000,
    });
  } finally {
    fixture.cleanup();
  }
});

test("mimo_wait_task rejects a missing task", async () => {
  const fixture = createFixture();
  try {
    const handler = createWaitTaskHandler(fixture.store);
    const result = await handler.handler({
      task_id: "task_missing",
      timeout_seconds: 1,
      detail_level: "summary",
      max_chars: 1000,
    });
    assert.match(result.error, /任务不存在/);
  } finally {
    fixture.cleanup();
  }
});

test("mimo_wait_task default timeout is 1800 seconds", () => {
  const parsed = createWaitTaskHandler({ getTask: () => null }).schema.safeParse({ task_id: "t1" });
  assert.ok(parsed.success);
  assert.strictEqual(parsed.data.timeout_seconds, 1800);
});

test("mimo_wait_task accepts timeout_seconds up to 3600", () => {
  const schema = createWaitTaskHandler({ getTask: () => null }).schema;
  const parsed = schema.safeParse({ task_id: "t1", timeout_seconds: 3600 });
  assert.ok(parsed.success);
  assert.strictEqual(parsed.data.timeout_seconds, 3600);
});

test("mimo_wait_task rejects timeout_seconds above 3600", () => {
  const schema = createWaitTaskHandler({ getTask: () => null }).schema;
  const parsed = schema.safeParse({ task_id: "t1", timeout_seconds: 3601 });
  assert.ok(!parsed.success);
});

test("mimo_wait_task returns terminal tasks immediately (early completion)", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "accepted");
    const handler = createWaitTaskHandler(fixture.store);
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      timeout_seconds: 3600,
      detail_level: "summary",
      max_chars: 1000,
    });
    assert.strictEqual(result.status, "accepted");
    assert.strictEqual(result.timed_out, false);
    assert.strictEqual(result.completed, true);
    assert.ok(result.waited_ms < 1000);
  } finally {
    fixture.cleanup();
  }
});
