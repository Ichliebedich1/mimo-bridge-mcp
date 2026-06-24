import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskStore } from "../dist/services/task-store.js";
import { createAgentGetTaskHandler } from "../dist/tools/agent-get-task.js";
import { createAgentWaitTaskHandler } from "../dist/tools/agent-wait-task.js";

function createFixture() {
  const runtimeDir = mkdtempSync(join(tmpdir(), "agent-get-wait-"));
  const store = new TaskStore(runtimeDir);
  const task = store.createTask(
    {
      objective: "agent get/wait task",
      workspace_path: runtimeDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 3,
      runtime_timeout_seconds: 60,
    },
    { agent: "reasonix-tui" }
  );
  return { runtimeDir, store, task, cleanup: () => rmSync(runtimeDir, { recursive: true, force: true }) };
}

test("agent_get_task returns a bounded Review Package and agent id", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "review");
    const handler = createAgentGetTaskHandler(fixture.store);
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "reasonix-tui",
      detail_level: "review",
      max_chars: 2000,
    });

    assert.strictEqual(result.task_id, fixture.task.task_id);
    assert.strictEqual(result.agent, "reasonix-tui");
    assert.strictEqual(result.detail_level, "review");
    assert.ok(result.review_package);
    assert.strictEqual("diff" in result, false);
    assert.strictEqual("raw_log_path" in result, false);
  } finally {
    fixture.cleanup();
  }
});

test("agent_get_task rejects mismatched agent_id", async () => {
  const fixture = createFixture();
  try {
    const handler = createAgentGetTaskHandler(fixture.store);
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "mimo",
      detail_level: "summary",
      max_chars: 1000,
    });
    assert.match(result.error, /belongs to agent reasonix-tui/);
  } finally {
    fixture.cleanup();
  }
});

test("agent_wait_task waits once and returns bounded review details with agent id", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "running");
    let now = 0;
    const handler = createAgentWaitTaskHandler(fixture.store, {
      now: () => now,
      pollIntervalMs: 100,
      sleep: async (milliseconds) => {
        now += milliseconds;
        fixture.store.updateTaskStatus(fixture.task.task_id, "review");
      },
    });
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "reasonix-tui",
      timeout_seconds: 10,
      detail_level: "review",
      max_chars: 2000,
    });

    assert.strictEqual(result.task_id, fixture.task.task_id);
    assert.strictEqual(result.agent, "reasonix-tui");
    assert.strictEqual(result.status, "review");
    assert.strictEqual(result.timed_out, false);
    assert.ok(result.review_package);
    assert.ok(JSON.stringify(result).length < 3000);
  } finally {
    fixture.cleanup();
  }
});

test("agent_wait_task timeout response stays minimal and includes agent id", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "running");
    let now = 0;
    const handler = createAgentWaitTaskHandler(fixture.store, {
      now: () => now,
      pollIntervalMs: 1000,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "reasonix-tui",
      timeout_seconds: 1,
      detail_level: "review",
      max_chars: 2000,
    });

    assert.deepStrictEqual(result, {
      task_id: fixture.task.task_id,
      status: "running",
      completed: false,
      timed_out: true,
      waited_ms: 1000,
      agent: "reasonix-tui",
    });
  } finally {
    fixture.cleanup();
  }
});
