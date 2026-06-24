import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findReasonixSessionPath } from "../dist/services/reasonix-session-store.js";

function writeSession(root, projectName, fileName, content = "{}\n") {
  const dir = join(root, "ReasonixData", "projects", projectName, "sessions");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, fileName);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

test("findReasonixSessionPath maps newest in-window task session under Reasonix home projects", () => {
  const root = mkdtempSync(join(tmpdir(), "reasonix-session-store-"));
  try {
    const startedAtMs = Date.now() - 1000;
    const taskId = "task_abcdef123456";
    const session = writeSession(
      root,
      `C--repo-worktree-${taskId}`,
      `20260625-000000.000000000-fake-${taskId}.jsonl`
    );
    writeSession(root, "C--other-project", "20260625-000000.000000000-other.jsonl");

    const result = findReasonixSessionPath({
      homeDir: join(root, "ReasonixData"),
      workspacePath: join(root, "repo", "worktree", taskId),
      taskId,
      startedAtMs,
      finishedAtMs: Date.now(),
    });

    assert.ok(result);
    assert.strictEqual(result.path, session);
    assert.ok(result.score > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findReasonixSessionPath ignores trash and files outside the task window", () => {
  const root = mkdtempSync(join(tmpdir(), "reasonix-session-store-trash-"));
  try {
    const taskId = "task_abcdef123456";
    const oldSession = writeSession(root, `C--repo-${taskId}`, `old-${taskId}.jsonl`);
    const trashDir = join(root, "ReasonixData", "projects", `C--repo-${taskId}`, "sessions", ".trash");
    mkdirSync(trashDir, { recursive: true });
    writeFileSync(join(trashDir, `trash-${taskId}.jsonl`), "{}\n", "utf-8");

    const result = findReasonixSessionPath({
      homeDir: join(root, "ReasonixData"),
      workspacePath: join(root, "repo", taskId),
      taskId,
      startedAtMs: Date.now() + 60_000,
      finishedAtMs: Date.now() + 61_000,
    });

    assert.strictEqual(result, null);
    assert.ok(oldSession);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
