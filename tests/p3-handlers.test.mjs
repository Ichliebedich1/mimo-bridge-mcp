import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { GitWorktreeManager } from "../dist/services/git-worktree.js";
import { TaskStore } from "../dist/services/task-store.js";
import { RunningTaskRegistry } from "../dist/services/running-tasks.js";
import { createMergeTaskHandler } from "../dist/tools/merge-task.js";
import { createStartTaskHandler } from "../dist/tools/start-task.js";
import { createReplyTaskHandler } from "../dist/tools/reply-task.js";

function createRepoFixture(name) {
  const root = join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const repoDir = join(root, "repo");
  const runtimeDir = join(root, "runtime");
  mkdirSync(join(repoDir, "allowed"), { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });

  execFileSync("git", ["init"], { cwd: repoDir, timeout: 10000 });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
  writeFileSync(join(repoDir, "README.md"), "# Test\n");
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });

  return { root, repoDir, runtimeDir };
}

function createReviewTask(fixture, editablePaths = ["allowed"]) {
  const taskStore = new TaskStore(fixture.runtimeDir);
  const task = taskStore.createTask({
    objective: "edit files",
    workspace_path: fixture.repoDir,
    editable_paths: editablePaths,
    readonly_paths: [],
    acceptance_criteria: [],
    max_rounds: 1,
    runtime_timeout_seconds: 60,
  });
  const manager = new GitWorktreeManager(fixture.repoDir, fixture.runtimeDir);
  const info = manager.createWorktree(task.task_id);
  const worktreeState = {
    repo_path: fixture.repoDir,
    worktrees_root: dirname(info.worktreePath),
    worktree_path: info.worktreePath,
    branch_name: info.branchName,
    base_commit: info.baseCommit,
    base_branch: manager.getCurrentBranch(),
    diff_summary: null,
    out_of_bounds_files: [],
    has_out_of_bounds_changes: false,
  };
  taskStore.updateTaskWorktree(task.task_id, worktreeState);
  taskStore.updateTaskStatus(task.task_id, "review");
  return { taskStore, task, info, worktreeState };
}

test("mimo_merge_task merges the saved runtime worktree and cleans it up", async () => {
  const fixture = createRepoFixture("p3-handler-merge");
  try {
    const taskStore = new TaskStore(fixture.runtimeDir);
    const task = taskStore.createTask({
      objective: "edit allowed file",
      workspace_path: fixture.repoDir,
      editable_paths: ["allowed"],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    const manager = new GitWorktreeManager(fixture.repoDir, fixture.runtimeDir);
    const baseBranch = manager.getCurrentBranch();
    const info = manager.createWorktree(task.task_id);
    const worktreesRoot = dirname(info.worktreePath);

    taskStore.updateTaskWorktree(task.task_id, {
      repo_path: fixture.repoDir,
      worktrees_root: worktreesRoot,
      worktree_path: info.worktreePath,
      branch_name: info.branchName,
      base_commit: info.baseCommit,
      base_branch: baseBranch,
      diff_summary: null,
      out_of_bounds_files: [],
      has_out_of_bounds_changes: false,
    });
    taskStore.updateTaskStatus(task.task_id, "review");

    mkdirSync(join(info.worktreePath, "allowed"), { recursive: true });
    writeFileSync(join(info.worktreePath, "allowed", "result.txt"), "merged\n");

    const mergeTask = createMergeTaskHandler(taskStore, { runtimeDir: fixture.runtimeDir });
    const result = await mergeTask.handler({ task_id: task.task_id, action: "merge" });

    assert.strictEqual(result.status, "merged");
    assert.strictEqual(
      readFileSync(join(fixture.repoDir, "allowed", "result.txt"), "utf-8").replace(/\r\n/g, "\n"),
      "merged\n"
    );
    assert.strictEqual(existsSync(info.worktreePath), false);
    assert.strictEqual(taskStore.getTask(task.task_id).worktree, null);
    const branch = execFileSync("git", ["branch", "--list", info.branchName], {
      cwd: fixture.repoDir,
      encoding: "utf-8",
    }).trim();
    assert.strictEqual(branch, "");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("mimo_merge_task rejects committed changes outside editable_paths", async () => {
  const fixture = createRepoFixture("p3-handler-oob");
  try {
    const { taskStore, task, info } = createReviewTask(fixture);
    writeFileSync(join(info.worktreePath, "outside.txt"), "blocked\n");
    execFileSync("git", ["add", "outside.txt"], { cwd: info.worktreePath });
    execFileSync("git", ["commit", "-m", "outside change"], { cwd: info.worktreePath });

    const mergeTask = createMergeTaskHandler(taskStore, { runtimeDir: fixture.runtimeDir });
    const result = await mergeTask.handler({ task_id: task.task_id, action: "merge" });

    assert.match(result.error, /editable_paths/);
    assert.ok(result.out_of_bounds_files.includes("outside.txt"));
    assert.strictEqual(existsSync(join(fixture.repoDir, "outside.txt")), false);
    assert.strictEqual(existsSync(info.worktreePath), true);
    assert.notStrictEqual(taskStore.getTask(task.task_id).worktree, null);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("mimo_merge_task discards the saved runtime worktree and branch", async () => {
  const fixture = createRepoFixture("p3-handler-discard");
  try {
    const { taskStore, task, info } = createReviewTask(fixture);
    writeFileSync(join(info.worktreePath, "discarded.txt"), "discard me\n");

    const mergeTask = createMergeTaskHandler(taskStore, { runtimeDir: fixture.runtimeDir });
    const result = await mergeTask.handler({ task_id: task.task_id, action: "discard" });

    assert.strictEqual(result.status, "discarded");
    assert.strictEqual(existsSync(info.worktreePath), false);
    assert.strictEqual(existsSync(join(fixture.repoDir, "discarded.txt")), false);
    assert.strictEqual(taskStore.getTask(task.task_id).worktree, null);
    const branch = execFileSync("git", ["branch", "--list", info.branchName], {
      cwd: fixture.repoDir,
      encoding: "utf-8",
    }).trim();
    assert.strictEqual(branch, "");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("mimo_merge_task rejects a worktree that belongs to another repository", async () => {
  const fixture = createRepoFixture("p3-handler-wrong-repo");
  const other = createRepoFixture("p3-handler-other-repo");
  try {
    const { taskStore, task, info, worktreeState } = createReviewTask(fixture);
    taskStore.updateTaskWorktree(task.task_id, {
      ...worktreeState,
      repo_path: other.repoDir,
    });

    const mergeTask = createMergeTaskHandler(taskStore, { runtimeDir: fixture.runtimeDir });
    const result = await mergeTask.handler({ task_id: task.task_id, action: "merge" });

    assert.match(result.error, /Worktree 根目录|不属于任务原仓库/);
    assert.strictEqual(existsSync(info.worktreePath), true);
    assert.notStrictEqual(taskStore.getTask(task.task_id).worktree, null);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(other.root, { recursive: true, force: true });
  }
});

test("mimo_start_task completion audits the saved runtime worktree", async () => {
  const fixture = createRepoFixture("p3-handler-start");
  try {
    const taskStore = new TaskStore(fixture.runtimeDir);
    const runningTasks = new RunningTaskRegistry();
    let completeTask;
    let runnerWorkspace;
    const startTask = createStartTaskHandler(
      {
        mimoNodePath: "unused-node",
        mimoEntryPath: "unused-entry",
        allowedRoots: [fixture.root],
        runtimeDir: fixture.runtimeDir,
      },
      taskStore,
      {
        runningTasks,
        runTask: (options, onResult) => {
          runnerWorkspace = options.task.config.workspace_path;
          completeTask = onResult;
          return { process: {}, cancel: () => {} };
        },
      }
    );

    const started = await startTask.handler({
      objective: "audit completion",
      workspace_path: fixture.repoDir,
      editable_paths: ["allowed"],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
      use_worktree: true,
    });
    assert.strictEqual(started.status, "running");
    assert.strictEqual(runnerWorkspace, started.worktree_path);

    writeFileSync(join(started.worktree_path, "outside.txt"), "committed outside\n");
    execFileSync("git", ["add", "outside.txt"], { cwd: started.worktree_path });
    execFileSync("git", ["commit", "-m", "outside change"], { cwd: started.worktree_path });

    completeTask({
      task_id: started.task_id,
      agent: "mimo",
      session_id: "ses_test",
      status: "review",
      summary: "done",
      modified_files: ["outside.txt"],
      test_results: "",
      questions: [],
      issues: [],
      raw_log_path: "",
      stderr_log_path: "",
      error: null,
    });

    const completed = taskStore.getTask(started.task_id);
    assert.strictEqual(completed.status, "review");
    assert.strictEqual(completed.worktree.has_out_of_bounds_changes, true);
    assert.ok(completed.worktree.out_of_bounds_files.includes("outside.txt"));
    assert.match(completed.worktree.diff_summary, /outside\.txt/);
    assert.strictEqual(runningTasks.size, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("mimo_reply_task keeps follow-up rounds in the saved Worktree and re-audits changes", async () => {
  const fixture = createRepoFixture("p3-handler-reply");
  try {
    const taskStore = new TaskStore(fixture.runtimeDir);
    const task = taskStore.createTask({
      objective: "continue editing in worktree",
      workspace_path: fixture.repoDir,
      editable_paths: ["allowed"],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 60,
    });
    const manager = new GitWorktreeManager(fixture.repoDir, fixture.runtimeDir);
    const info = manager.createWorktree(task.task_id);
    taskStore.updateTaskWorktree(task.task_id, {
      repo_path: fixture.repoDir,
      worktrees_root: dirname(info.worktreePath),
      worktree_path: info.worktreePath,
      branch_name: info.branchName,
      base_commit: info.baseCommit,
      base_branch: manager.getCurrentBranch(),
      diff_summary: null,
      out_of_bounds_files: [],
      has_out_of_bounds_changes: false,
    });
    taskStore.updateTaskStatus(task.task_id, "review");
    taskStore.updateTaskSession(task.task_id, "ses_reply_worktree");

    const runningTasks = new RunningTaskRegistry();
    let runnerOptions;
    let completeReply;
    const replyTask = createReplyTaskHandler(
      {
        mimoNodePath: "unused-node",
        mimoEntryPath: "unused-entry",
        allowedRoots: [fixture.root],
        runtimeDir: fixture.runtimeDir,
      },
      taskStore,
      {
        runningTasks,
        runTask: (options, onResult) => {
          runnerOptions = options;
          completeReply = onResult;
          return { process: {}, cancel: () => {} };
        },
      }
    );

    const started = await replyTask.handler({ task_id: task.task_id, message: "continue" });
    assert.strictEqual(started.status, "running");
    assert.strictEqual(runnerOptions.task.config.workspace_path, info.worktreePath);

    writeFileSync(join(info.worktreePath, "outside.txt"), "follow-up outside change\n");
    completeReply({
      task_id: task.task_id,
      agent: "mimo",
      session_id: "ses_reply_worktree",
      status: "review",
      summary: "reply done",
      modified_files: ["outside.txt"],
      test_results: "",
      questions: [],
      issues: [],
      raw_log_path: "",
      stderr_log_path: "",
      error: null,
    });

    const completed = taskStore.getTask(task.task_id);
    assert.strictEqual(completed.worktree.has_out_of_bounds_changes, true);
    assert.ok(completed.worktree.out_of_bounds_files.includes("outside.txt"));
    assert.match(completed.worktree.diff_summary, /outside\.txt/);
    assert.strictEqual(runningTasks.size, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("mimo_merge_task refuses to overwrite a dirty original repository", async () => {
  const fixture = createRepoFixture("p3-handler-dirty-repo");
  try {
    const { taskStore, task, info } = createReviewTask(fixture);
    writeFileSync(join(fixture.repoDir, "local-only.txt"), "keep me\n");

    const mergeTask = createMergeTaskHandler(taskStore, { runtimeDir: fixture.runtimeDir });
    const result = await mergeTask.handler({ task_id: task.task_id, action: "merge" });

    assert.match(result.error, /未提交修改/);
    assert.strictEqual(existsSync(info.worktreePath), true);
    assert.notStrictEqual(taskStore.getTask(task.task_id).worktree, null);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("mimo_merge_task merges into the branch saved when the task started", async () => {
  const fixture = createRepoFixture("p3-handler-base-branch");
  try {
    execFileSync("git", ["checkout", "-b", "feature-base"], { cwd: fixture.repoDir });
    const { taskStore, task, info } = createReviewTask(fixture);
    execFileSync("git", ["checkout", "master"], { cwd: fixture.repoDir });
    mkdirSync(join(info.worktreePath, "allowed"), { recursive: true });
    writeFileSync(join(info.worktreePath, "allowed", "branch.txt"), "feature only\n");

    const mergeTask = createMergeTaskHandler(taskStore, { runtimeDir: fixture.runtimeDir });
    const result = await mergeTask.handler({ task_id: task.task_id, action: "merge" });

    assert.strictEqual(result.status, "merged");
    assert.strictEqual(result.target_branch, "feature-base");
    const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: fixture.repoDir,
      encoding: "utf-8",
    }).trim();
    assert.strictEqual(currentBranch, "feature-base");
    assert.throws(() => {
      execFileSync("git", ["show", "master:allowed/branch.txt"], {
        cwd: fixture.repoDir,
        stdio: "pipe",
      });
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
