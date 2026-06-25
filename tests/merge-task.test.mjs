import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TaskStore } from "../dist/services/task-store.js";
import { GitWorktreeManager } from "../dist/services/git-worktree.js";
import { createMergeTaskHandler } from "../dist/tools/merge-task.js";

test("merge-task allows discarding failed task Worktrees but still rejects merging them", async () => {
  const root = join(tmpdir(), "merge-task-failed-discard-" + Date.now());
  const repoDir = join(root, "repo");
  const runtimeDir = join(root, "runtime");
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  execFileSync("git", ["init", "-b", "master"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
  writeFileSync(join(repoDir, "README.md"), "fixture\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir });

  try {
    const store = new TaskStore(runtimeDir);
    const task = store.createTask({
      objective: "failed worktree cleanup",
      workspace_path: repoDir,
      editable_paths: ["README.md"],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree(task.task_id);
    store.updateTaskWorktree(task.task_id, {
      repo_path: info.repoPath,
      worktrees_root: info.worktreesRoot,
      worktree_path: info.worktreePath,
      branch_name: info.branchName,
      base_commit: info.baseCommit,
      base_branch: info.baseBranch,
      diff_summary: null,
      out_of_bounds_files: [],
      has_out_of_bounds_changes: false,
    });
    store.updateTaskStatus(task.task_id, "failed");

    const handler = createMergeTaskHandler(store, { runtimeDir });
    const merge = await handler.handler({ task_id: task.task_id, action: "merge" });
    assert.match(merge.error, /不允许合并|涓嶅厑璁稿悎骞?/);

    const discard = await handler.handler({ task_id: task.task_id, action: "discard" });
    assert.strictEqual(discard.status, "discarded");
    assert.strictEqual(existsSync(info.worktreePath), false);
    assert.strictEqual(store.getTask(task.task_id).worktree, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("merge-task discard clears stale failed Worktree records when path is already gone", async () => {
  const root = join(tmpdir(), "merge-task-stale-discard-" + Date.now());
  const repoDir = join(root, "repo");
  const runtimeDir = join(root, "runtime");
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  execFileSync("git", ["init", "-b", "master"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
  writeFileSync(join(repoDir, "README.md"), "fixture\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir });

  try {
    const store = new TaskStore(runtimeDir);
    const task = store.createTask({
      objective: "stale failed worktree cleanup",
      workspace_path: repoDir,
      editable_paths: ["README.md"],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree(task.task_id);
    store.updateTaskWorktree(task.task_id, {
      repo_path: info.repoPath,
      worktrees_root: info.worktreesRoot,
      worktree_path: info.worktreePath,
      branch_name: info.branchName,
      base_commit: info.baseCommit,
      base_branch: info.baseBranch,
      diff_summary: null,
      out_of_bounds_files: [],
      has_out_of_bounds_changes: false,
    });
    store.updateTaskStatus(task.task_id, "failed");
    rmSync(info.worktreePath, { recursive: true, force: true });

    const handler = createMergeTaskHandler(store, { runtimeDir });
    const discard = await handler.handler({ task_id: task.task_id, action: "discard" });

    assert.strictEqual(discard.status, "discarded");
    assert.strictEqual(store.getTask(task.task_id).worktree, null);
    assert.strictEqual(execFileSync("git", ["branch", "--list", info.branchName], { cwd: repoDir, encoding: "utf-8" }).trim(), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
