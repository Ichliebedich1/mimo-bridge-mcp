import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskStore } from "../dist/services/task-store.js";
import { getPendingReviewsSnapshot } from "../dist/services/pending-reviews.js";

function createTask(store, runtimeDir, agent, objective) {
  return store.createTask(
    {
      objective,
      workspace_path: runtimeDir,
      editable_paths: ["src"],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 3,
      runtime_timeout_seconds: 60,
    },
    { agent }
  );
}

test("pending review snapshot can filter generic agent tasks", () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "pending-reviews-agent-"));
  const store = new TaskStore(runtimeDir);
  try {
    const mimoTask = createTask(store, runtimeDir, "mimo", "mimo review task");
    const reasonixTask = createTask(store, runtimeDir, "reasonix-tui", "reasonix review task");
    const runningReasonixTask = createTask(store, runtimeDir, "reasonix-tui", "running reasonix task");
    store.updateTaskStatus(mimoTask.task_id, "review");
    store.updateTaskStatus(reasonixTask.task_id, "review");
    store.updateTaskStatus(runningReasonixTask.task_id, "running");

    const result = getPendingReviewsSnapshot(store, {
      agent_id: "reasonix-tui",
      limit: 10,
      max_chars: 8000,
    });

    assert.strictEqual(result.agent_id, "reasonix-tui");
    assert.strictEqual(result.pending_count, 1);
    assert.strictEqual(result.returned_count, 1);
    assert.strictEqual(result.tasks[0].task_id, reasonixTask.task_id);
    assert.strictEqual(result.tasks[0].agent, "reasonix-tui");
    assert.match(result.tasks[0].review_command, /agent-review --agent-id reasonix-tui/);
    assert.match(result.next_review_command, /agent-review --agent-id reasonix-tui/);
    assert.strictEqual(JSON.stringify(result).includes("raw_log_path"), false);
    assert.strictEqual(JSON.stringify(result).includes("stderr_log_path"), false);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("pending review snapshot keeps MiMo review command for MiMo tasks", () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "pending-reviews-mimo-"));
  const store = new TaskStore(runtimeDir);
  try {
    const task = createTask(store, runtimeDir, "mimo", "mimo review task");
    store.updateTaskStatus(task.task_id, "review");

    const result = getPendingReviewsSnapshot(store, {
      agent_id: "mimo",
      limit: 10,
      max_chars: 8000,
    });

    assert.strictEqual(result.agent_id, "mimo");
    assert.strictEqual(result.pending_count, 1);
    assert.match(result.tasks[0].review_command, /mimo-bridge-client\.mjs review --task-id/);
    assert.strictEqual(result.tasks[0].review_command.includes("agent-review"), false);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("pending review snapshot includes failed tasks that still need Codex intervention", () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "pending-reviews-failed-"));
  const store = new TaskStore(runtimeDir);
  try {
    const failedTask = createTask(store, runtimeDir, "reasonix-tui", "reasonix failed task");
    store.updateTaskStatus(failedTask.task_id, "failed", "Reasonix paused after max steps");

    const result = getPendingReviewsSnapshot(store, {
      agent_id: "reasonix-tui",
      limit: 10,
      max_chars: 8000,
    });

    assert.strictEqual(result.pending_count, 1);
    assert.strictEqual(result.tasks[0].task_id, failedTask.task_id);
    assert.strictEqual(result.tasks[0].status, "failed");
    assert.strictEqual(result.tasks[0].attention_reason, "failed_needs_attention");
    assert.match(result.tasks[0].review_command, /agent-review --agent-id reasonix-tui/);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});
