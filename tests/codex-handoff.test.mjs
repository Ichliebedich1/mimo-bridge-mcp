import { test } from "node:test";
import assert from "node:assert";

import {
  CODEX_NEW_THREAD_URL,
  buildCodexReviewPrompt,
  copyCodexReviewPrompt,
} from "../apps/admin-ui/src/codex-handoff.mjs";

const task = {
  id: "task_123456789abc",
  status: "review",
  title: "实现共享任务看板",
  objective: "让 Codex 和 MiMo 协同完成任务",
};

test("Codex handoff prompt identifies the task and starts with bounded review evidence", () => {
  const prompt = buildCodexReviewPrompt(task);

  assert.match(prompt, /task_123456789abc/);
  assert.match(prompt, /detail_level="review"/);
  assert.match(prompt, /max_chars=8000/);
  assert.match(prompt, /复杂或高风险部分.*Codex.*直接执行/);
  assert.doesNotMatch(prompt, /默认.*full/);
  assert.strictEqual(CODEX_NEW_THREAD_URL, "codex://threads/new");
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
