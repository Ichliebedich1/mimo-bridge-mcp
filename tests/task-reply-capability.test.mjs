import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskStore } from "../dist/services/task-store.js";
import { computeTaskReplyCapability } from "../dist/services/task-reply-capability.js";

function createTask(store, runtimeDir, agent = "mimo") {
  return store.createTask(
    {
      objective: "reply capability",
      workspace_path: runtimeDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    },
    { agent }
  );
}

test("reply capability explains why failed MiMo task without session cannot continue", () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "reply-capability-mimo-"));
  const store = new TaskStore(runtimeDir);
  try {
    const task = createTask(store, runtimeDir, "mimo");
    store.updateTaskStatus(task.task_id, "failed", "daemon restarted");

    const result = computeTaskReplyCapability(store.getTask(task.task_id), []);

    assert.strictEqual(result.can_reply, false);
    assert.match(result.reply_blockers.join(" "), /MiMo 会话 ID/);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("reply capability allows failed Reasonix task with safe existing session", () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "reply-capability-reasonix-"));
  const store = new TaskStore(runtimeDir);
  try {
    const sessionDir = join(runtimeDir, "ReasonixData", "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = join(sessionDir, "session.jsonl");
    writeFileSync(sessionPath, "{}\n", "utf-8");

    const task = createTask(store, runtimeDir, "reasonix-tui");
    store.updateTaskAgentSession(task.task_id, sessionPath);
    store.updateTaskStatus(task.task_id, "failed", "paused after max steps");

    const result = computeTaskReplyCapability(store.getTask(task.task_id), [
      {
        id: "reasonix-tui",
        kind: "reasonix-tui",
        display_name: "Reasonix TUI",
        enabled: true,
        command: process.execPath,
        home_dir: join(runtimeDir, "ReasonixData"),
      },
    ]);

    assert.strictEqual(result.can_reply, true);
    assert.deepStrictEqual(result.reply_blockers, []);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("reply capability blocks Reasonix when session file is gone", () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "reply-capability-missing-"));
  const store = new TaskStore(runtimeDir);
  try {
    const task = createTask(store, runtimeDir, "reasonix-tui");
    store.updateTaskAgentSession(task.task_id, join(runtimeDir, "ReasonixData", "sessions", "missing.jsonl"));
    store.updateTaskStatus(task.task_id, "failed", "paused after max steps");

    const result = computeTaskReplyCapability(store.getTask(task.task_id), [
      {
        id: "reasonix-tui",
        kind: "reasonix-tui",
        display_name: "Reasonix TUI",
        enabled: true,
        command: process.execPath,
        home_dir: join(runtimeDir, "ReasonixData"),
      },
    ]);

    assert.strictEqual(result.can_reply, false);
    assert.match(result.reply_blockers.join(" "), /会话文件已不存在/);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});
