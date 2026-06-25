import { test } from "node:test";
import assert from "node:assert";

import {
  CODEX_NEW_THREAD_URL,
  buildCodexReviewPrompt,
  copyCodexReviewPrompt,
  isSafeCodexThreadUrl,
  buildCodexThreadUrl,
  resolveCodexHandoffUrl,
} from "../apps/admin-ui/src/codex-handoff.mjs";

const task = {
  id: "task_123456789abc",
  agent: "mimo",
  status: "review",
  title: "实现共享任务看板",
  objective: "让 Codex 和 MiMo 协同完成任务",
};

test("Codex handoff prompt identifies the task and starts with bounded review evidence", () => {
  const prompt = buildCodexReviewPrompt(task);

  assert.match(prompt, /task_123456789abc/);
  assert.match(prompt, /detail_level="review"/);
  assert.match(prompt, /max_chars=8000/);
  assert.match(prompt, /mimo_get_task/);
  assert.match(prompt, /复杂或高风险部分.*Codex.*直接执行/);
  assert.doesNotMatch(prompt, /默认.*full/);
  assert.strictEqual(CODEX_NEW_THREAD_URL, "codex://threads/new");
});

test("Codex handoff prompt uses generic agent review commands for Reasonix tasks", () => {
  const prompt = buildCodexReviewPrompt({
    ...task,
    agent: "reasonix-tui",
  });

  assert.match(prompt, /Reasonix TUI|reasonix-tui/);
  assert.match(prompt, /agent-review --agent-id reasonix-tui --task-id task_123456789abc --detail-level review --max-chars 8000/);
  assert.match(prompt, /agent_get_task\(agent_id="reasonix-tui", task_id="task_123456789abc", detail_level="review", max_chars=8000\)/);
  assert.doesNotMatch(prompt, /mimo_get_task/);
});

test("Codex handoff copies the generated review prompt through the public helper", async () => {
  let copiedText = "";

  const result = await copyCodexReviewPrompt(task, async (text) => {
    copiedText = text;
  });

  assert.strictEqual(result.copied, true);
  assert.strictEqual(result.prompt, copiedText);
  assert.match(copiedText, /task_123456789abc/);
  assert.strictEqual(result.url, "codex://threads/new");
});

test("Codex handoff returns a usable prompt when clipboard access fails", async () => {
  const result = await copyCodexReviewPrompt(task, async () => {
    throw new Error("clipboard denied");
  });

  assert.strictEqual(result.copied, false);
  assert.match(result.prompt, /task_123456789abc/);
  assert.match(result.error, /clipboard denied/);
});

test("isSafeCodexThreadUrl accepts codex://threads/new", () => {
  assert.strictEqual(isSafeCodexThreadUrl("codex://threads/new"), true);
});

test("isSafeCodexThreadUrl accepts codex://threads/<safe-id>", () => {
  assert.strictEqual(isSafeCodexThreadUrl("codex://threads/abc123-def_456"), true);
});

test("isSafeCodexThreadUrl rejects arbitrary schemes", () => {
  assert.strictEqual(isSafeCodexThreadUrl("javascript:alert(1)"), false);
  assert.strictEqual(isSafeCodexThreadUrl("https://evil.com"), false);
  assert.strictEqual(isSafeCodexThreadUrl("codex://evil/path"), false);
});

test("isSafeCodexThreadUrl rejects non-strings", () => {
  assert.strictEqual(isSafeCodexThreadUrl(null), false);
  assert.strictEqual(isSafeCodexThreadUrl(undefined), false);
  assert.strictEqual(isSafeCodexThreadUrl(42), false);
});

test("isSafeCodexThreadUrl rejects thread IDs with special characters", () => {
  assert.strictEqual(isSafeCodexThreadUrl("codex://threads/../../etc/passwd"), false);
  assert.strictEqual(isSafeCodexThreadUrl("codex://threads/<script>"), false);
});

test("buildCodexThreadUrl returns codex://threads/<id> for safe IDs", () => {
  assert.strictEqual(buildCodexThreadUrl("abc123"), "codex://threads/abc123");
  assert.strictEqual(buildCodexThreadUrl("thread-123_abc"), "codex://threads/thread-123_abc");
});

test("buildCodexThreadUrl returns null for unsafe IDs", () => {
  assert.strictEqual(buildCodexThreadUrl("../../../etc/passwd"), null);
  assert.strictEqual(buildCodexThreadUrl("<script>"), null);
  assert.strictEqual(buildCodexThreadUrl(""), null);
  assert.strictEqual(buildCodexThreadUrl(null), null);
});

test("resolveCodexHandoffUrl returns thread URL when origin thread id exists", () => {
  const url = resolveCodexHandoffUrl("abc123", null);
  assert.strictEqual(url, "codex://threads/abc123");
});

test("resolveCodexHandoffUrl falls back to safe origin URL when thread id is invalid", () => {
  const url = resolveCodexHandoffUrl(null, "codex://threads/safe-thread");
  assert.strictEqual(url, "codex://threads/safe-thread");
});

test("resolveCodexHandoffUrl returns new thread URL when no origin info", () => {
  const url = resolveCodexHandoffUrl(null, null);
  assert.strictEqual(url, CODEX_NEW_THREAD_URL);
});

test("resolveCodexHandoffUrl rejects unsafe origin URL", () => {
  const url = resolveCodexHandoffUrl(null, "javascript:alert(1)");
  assert.strictEqual(url, CODEX_NEW_THREAD_URL);
});

test("copyCodexReviewPrompt returns origin thread URL when task has origin info", async () => {
  const taskWithOrigin = {
    ...task,
    originCodexThreadId: "thread-abc-123",
  };
  const result = await copyCodexReviewPrompt(taskWithOrigin, async () => {});
  assert.strictEqual(result.url, "codex://threads/thread-abc-123");
});

test("copyCodexReviewPrompt falls back to new thread URL when no origin info", async () => {
  const result = await copyCodexReviewPrompt(task, async () => {});
  assert.strictEqual(result.url, CODEX_NEW_THREAD_URL);
});
