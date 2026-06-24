import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskStore } from "../dist/services/task-store.js";
import { createAgentListTasksHandler } from "../dist/tools/agent-list-tasks.js";

function createTask(store, runtimeDir, agent, objective) {
  return store.createTask(
    {
      objective,
      workspace_path: runtimeDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 3,
      runtime_timeout_seconds: 60,
    },
    { agent }
  );
}

test("agent_list_tasks returns bounded summaries filtered by agent_id", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "agent-list-tasks-"));
  const store = new TaskStore(runtimeDir);
  try {
    const reasonixTask = createTask(store, runtimeDir, "reasonix-tui", "reasonix objective");
    const mimoTask = createTask(store, runtimeDir, "mimo", "mimo objective");
    store.updateTaskStatus(reasonixTask.task_id, "review");
    store.updateTaskResult(reasonixTask.task_id, {
      summary: "done C:\\sensitive\\workspace\\file.txt token_secret=abc123",
      raw_log_path: "C:\\sensitive\\raw.jsonl",
      stderr_log_path: "C:\\sensitive\\stderr.log",
    });
    store.updateTaskStatus(mimoTask.task_id, "running");

    const handler = createAgentListTasksHandler(store);
    const result = await handler.handler({ agent_id: "reasonix-tui", limit: 10 });

    assert.strictEqual(result.agent_id, "reasonix-tui");
    assert.strictEqual(result.returned_count, 1);
    assert.strictEqual(result.tasks[0].task_id, reasonixTask.task_id);
    assert.strictEqual(result.tasks[0].agent, "reasonix-tui");
    assert.strictEqual(result.tasks[0].objective, "reasonix objective");
    assert.match(result.tasks[0].summary, /done/);
    assert.strictEqual(result.tasks[0].summary.includes("sensitive"), false);
    assert.strictEqual(result.tasks[0].summary.includes("abc123"), false);
    assert.strictEqual(JSON.stringify(result).includes("raw_log_path"), false);
    assert.strictEqual(JSON.stringify(result).includes("sensitive"), false);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("agent_list_tasks truncates long summaries for low-context listing", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "agent-list-tasks-long-"));
  const store = new TaskStore(runtimeDir);
  try {
    const task = createTask(store, runtimeDir, "reasonix-tui", "long summary");
    store.updateTaskResult(task.task_id, {
      summary: "x".repeat(2000),
    });

    const handler = createAgentListTasksHandler(store);
    const result = await handler.handler({ agent_id: "reasonix-tui", limit: 10 });

    assert.ok(result.tasks[0].summary.length < 550);
    assert.match(result.tasks[0].summary, /truncated/);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("agent_list_tasks includes safe-delete metadata", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "agent-list-tasks-delete-"));
  const store = new TaskStore(runtimeDir);
  try {
    const task = createTask(store, runtimeDir, "reasonix-tui", "accepted task");
    store.updateTaskStatus(task.task_id, "accepted");

    const handler = createAgentListTasksHandler(store);
    const result = await handler.handler({ agent_id: "reasonix-tui", limit: 10 });

    assert.strictEqual(result.tasks[0].can_delete, true);
    assert.deepStrictEqual(result.tasks[0].delete_blockers, []);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("agent_list_tasks filters by agent before applying result limit", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "agent-list-tasks-filter-limit-"));
  const store = new TaskStore(runtimeDir);
  try {
    createTask(store, runtimeDir, "reasonix-tui", "older reasonix");
    createTask(store, runtimeDir, "mimo", "newer mimo one");
    createTask(store, runtimeDir, "mimo", "newer mimo two");

    const handler = createAgentListTasksHandler(store);
    const result = await handler.handler({ agent_id: "reasonix-tui", limit: 1 });

    assert.strictEqual(result.returned_count, 1);
    assert.strictEqual(result.tasks[0].agent, "reasonix-tui");
    assert.strictEqual(result.tasks[0].objective, "older reasonix");
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});
