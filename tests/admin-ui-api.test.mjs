import { test } from "node:test";
import assert from "node:assert";

import { buildCodexReviewPrompt } from "../apps/admin-ui/src/codex-handoff.mjs";

test("codex handoff prompt uses Chinese objective when available", () => {
  const task = {
    id: "task-1",
    title: "修复登录页面的中文显示问题",
    objective: "修复登录页面的中文显示问题",
    status: "review",
  };
  const prompt = buildCodexReviewPrompt(task);
  assert.match(prompt, /目标：修复登录页面的中文显示问题/);
});

test("codex handoff prompt falls back to English objective when no Chinese", () => {
  const task = {
    id: "task-2",
    title: "fix login page rendering",
    objective: "fix login page rendering",
    status: "review",
  };
  const prompt = buildCodexReviewPrompt(task);
  assert.match(prompt, /目标：fix login page rendering/);
});

test("codex handoff prompt includes Chinese language requirement", () => {
  const task = { id: "task-3", title: "test", objective: "test", status: "review" };
  const prompt = buildCodexReviewPrompt(task);
  assert.match(prompt, /后续任务摘要.*应使用中文/);
});
