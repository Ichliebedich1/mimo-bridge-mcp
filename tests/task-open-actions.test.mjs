import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createOpenTaskTargetHandler, resolveOpenTarget } from "../apps/local-daemon/dist/apps/local-daemon/src/task-open-actions.js";
import { TaskStore } from "../dist/services/task-store.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "task-open-actions-"));
}

function daemonConfig(root, agents = []) {
  return {
    host: "127.0.0.1",
    port: 3210,
    runtimeDir: join(root, "runtime"),
    configError: null,
    mimoVersion: null,
    mcpConfig: {
      mimoNodePath: process.execPath,
      mimoEntryPath: "fake-mimo.mjs",
      allowedRoots: [join(root, "repo")],
      runtimeDir: join(root, "runtime"),
      agents,
    },
    agents,
  };
}

test("resolveOpenTarget prefers active worktree for task folder", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const worktreesRoot = join(runtime, "worktrees");
    const worktree = join(worktreesRoot, "repo", "task_abcdef123456");
    mkdirSync(repo, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open folder",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    store.updateTaskWorktree(task.task_id, {
      repo_path: repo,
      worktrees_root: worktreesRoot,
      worktree_path: worktree,
      branch_name: "task/test",
      base_commit: "base",
      base_branch: "master",
      diff_summary: null,
      out_of_bounds_files: [],
      has_out_of_bounds_changes: false,
    });

    const resolved = resolveOpenTarget(daemonConfig(root), store.getTask(task.task_id), "task_folder");
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "worktree");
    assert.strictEqual(resolved.path, resolve(worktree));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget falls back to allowed workspace when worktree is gone", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    mkdirSync(repo, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open workspace",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });

    const resolved = resolveOpenTarget(daemonConfig(root), task, "task_folder");
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "workspace");
    assert.strictEqual(resolved.path, resolve(repo));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget rejects workspace outside allowed roots", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const outside = join(root, "outside");
    const runtime = join(root, "runtime");
    mkdirSync(repo, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "blocked",
      workspace_path: outside,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });

    const resolved = resolveOpenTarget(daemonConfig(root), task, "task_folder");
    assert.ok("error" in resolved);
    assert.match(resolved.error, /allowedRoots/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget opens Reasonix session folder only under configured home", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const reasonixHome = join(root, "ReasonixData");
    const sessionDir = join(reasonixHome, "projects", "repo", "sessions");
    const sessionPath = join(sessionDir, "session.jsonl");
    mkdirSync(repo, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(sessionPath, "{}\n", "utf-8");
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "session folder",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    }, { agent: "reasonix-tui" });
    store.updateTaskAgentSession(task.task_id, sessionPath);

    const resolved = resolveOpenTarget(
      daemonConfig(root, [{ id: "reasonix-tui", kind: "reasonix-tui", display_name: "Reasonix TUI", enabled: true, home_dir: reasonixHome }]),
      store.getTask(task.task_id),
      "session_folder"
    );
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "reasonix_session_folder");
    assert.strictEqual(resolved.path, resolve(sessionDir));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createOpenTaskTargetHandler opens resolved target without returning local path", async () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    mkdirSync(repo, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    const opened = [];
    const handler = createOpenTaskTargetHandler(daemonConfig(root), store, {
      openPath: (path) => {
        opened.push(path);
        return { ok: true };
      },
    });

    const result = await handler.handler({ task_id: task.task_id, action: "task_folder" });
    assert.ok(!("error" in result));
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(result.opened, true);
    assert.strictEqual(JSON.stringify(result).includes(repo), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
