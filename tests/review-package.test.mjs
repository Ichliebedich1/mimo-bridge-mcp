import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskStore } from "../dist/services/task-store.js";
import { RunningTaskRegistry } from "../dist/services/running-tasks.js";
import { GitWorktreeManager } from "../dist/services/git-worktree.js";
import { getFocusedFiles } from "../dist/services/review-package.js";
import { createGetTaskHandler } from "../dist/tools/get-task.js";
import { createStartTaskHandler } from "../dist/tools/start-task.js";

function createTaskFixture(name) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  const store = new TaskStore(root);
  const task = store.createTask({
    objective: "review a small change",
    workspace_path: workspace,
    editable_paths: ["src"],
    readonly_paths: [],
    acceptance_criteria: ["tests pass"],
    max_rounds: 1,
    runtime_timeout_seconds: 60,
  });
  return { root, workspace, store, task };
}

function createWorktreeFixture(name) {
  const fixture = createTaskFixture(name);
  mkdirSync(join(fixture.workspace, "src"), { recursive: true });
  execFileSync("git", ["init"], { cwd: fixture.workspace });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: fixture.workspace });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: fixture.workspace });
  writeFileSync(join(fixture.workspace, "src", "example.ts"), "export const value = 1;\n", "utf-8");
  execFileSync("git", ["add", "."], { cwd: fixture.workspace });
  execFileSync("git", ["commit", "-m", "init"], { cwd: fixture.workspace });

  const manager = new GitWorktreeManager(fixture.workspace, fixture.root);
  const info = manager.createWorktree(fixture.task.task_id);
  fixture.store.updateTaskWorktree(fixture.task.task_id, {
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
  return { ...fixture, manager, info };
}

test("mimo_get_task defaults to a bounded review package without full logs or diff", async () => {
  const fixture = createTaskFixture("review-default");
  try {
    const rawLogPath = join(fixture.root, "logs", `${fixture.task.task_id}.jsonl`);
    const stderrLogPath = join(fixture.root, "logs", `${fixture.task.task_id}.stderr.log`);
    writeFileSync(rawLogPath, `${"raw-event\n".repeat(500)}`, "utf-8");
    writeFileSync(stderrLogPath, `${"stderr-line\n".repeat(500)}`, "utf-8");

    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.summary = "MiMo completed the requested change.";
    task.modified_files = ["src/example.ts"];
    task.test_results = "npm.cmd test: passed";
    task.raw_log_path = rawLogPath;
    task.stderr_log_path = stderrLogPath;
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({ task_id: task.task_id });

    assert.strictEqual(result.detail_level, "review");
    assert.ok(result.review_package);
    assert.strictEqual(result.review_package.task_id, task.task_id);
    assert.ok(result.review_package.log_tail.length < 2000);
    assert.strictEqual("diff" in result, false);
    assert.strictEqual("raw_log" in result, false);
    assert.strictEqual("stderr_log" in result, false);
    assert.strictEqual("raw_log_path" in result, false);
    assert.strictEqual("stderr_log_path" in result, false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("review package flags out-of-bounds changes", async () => {
  const fixture = createTaskFixture("review-oob");
  try {
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.worktree = {
      repo_path: fixture.workspace,
      worktrees_root: fixture.root,
      worktree_path: fixture.workspace,
      branch_name: `task/${task.task_id}`,
      base_commit: "base",
      base_branch: "master",
      diff_summary: "1 file changed",
      out_of_bounds_files: ["outside.txt"],
      has_out_of_bounds_changes: true,
    };
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({ task_id: task.task_id, detail_level: "review" });

    assert.ok(result.review_package.risk_flags.includes("OUT_OF_BOUNDS_CHANGES"));
    assert.deepStrictEqual(result.review_package.out_of_bounds_report.files, ["outside.txt"]);
    assert.strictEqual(result.review_package.review_recommendation, "reject");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("review package flags failed tests", async () => {
  const fixture = createTaskFixture("review-tests-failed");
  try {
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.test_results = "npm.cmd test\n2 tests failed";
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({ task_id: task.task_id, detail_level: "review" });

    assert.strictEqual(result.review_package.test_result, "failed");
    assert.ok(result.review_package.risk_flags.includes("TESTS_FAILED"));
    assert.strictEqual(result.review_package.review_recommendation, "needs_attention");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("review package supports tasks with no changed files", async () => {
  const fixture = createTaskFixture("review-empty-changes");
  try {
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.summary = "No file changes were required.";
    task.modified_files = [];
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({ task_id: task.task_id, detail_level: "review" });

    assert.deepStrictEqual(result.review_package.changed_files, []);
    assert.strictEqual(result.review_package.changed_files_count, 0);
    assert.ok(result.review_package.risk_flags.includes("NO_CHANGES_AND_NO_TESTS"));
    assert.strictEqual(result.review_package.review_recommendation, "needs_attention");
    assert.ok(result.review_package.generated_at);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("MiMo completion automatically persists a review package", async () => {
  const fixture = createTaskFixture("review-auto-generate");
  try {
    const runningTasks = new RunningTaskRegistry();
    let completeTask;
    const startTask = createStartTaskHandler(
      {
        mimoNodePath: "unused",
        mimoEntryPath: "unused",
        allowedRoots: [fixture.root],
        runtimeDir: fixture.root,
      },
      fixture.store,
      {
        runningTasks,
        runTask: (_options, onResult) => {
          completeTask = onResult;
          return { process: {}, cancel: () => {} };
        },
      }
    );

    const started = await startTask.handler({
      objective: "generate review package",
      workspace_path: fixture.workspace,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
      use_worktree: false,
      priority: 5,
    });
    completeTask({
      task_id: started.task_id,
      agent: "mimo",
      session_id: "ses_review",
      status: "review",
      summary: "implementation complete",
      modified_files: [],
      test_results: "npm.cmd test: passed",
      questions: [],
      issues: [],
      raw_log_path: "",
      stderr_log_path: "",
      error: null,
      exit_code: 0,
    });

    const completed = fixture.store.getTask(started.task_id);
    assert.ok(completed.review_package);
    assert.strictEqual(completed.review_package.mimo_summary, "implementation complete");
    assert.strictEqual(completed.review_package.exit_code, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("diff mode truncates output to max_chars", async () => {
  const fixture = createWorktreeFixture("review-diff-budget");
  try {
    writeFileSync(
      join(fixture.info.worktreePath, "src", "example.ts"),
      Array.from({ length: 400 }, (_, index) => `export const value${index} = ${index};`).join("\n"),
      "utf-8"
    );

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({
      task_id: fixture.task.task_id,
      detail_level: "diff",
      max_chars: 1000,
    });

    assert.strictEqual(result.detail_level, "diff");
    assert.ok(result.diff.length <= 1000);
    assert.strictEqual(result.truncated, true);
    assert.ok(result.total_chars > result.returned_chars);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("logs mode returns only the requested tail lines", async () => {
  const fixture = createTaskFixture("review-log-tail");
  try {
    const rawLogPath = join(fixture.root, "logs", `${fixture.task.task_id}.jsonl`);
    const stderrLogPath = join(fixture.root, "logs", `${fixture.task.task_id}.stderr.log`);
    writeFileSync(rawLogPath, Array.from({ length: 50 }, (_, index) => `out-${index + 1}`).join("\n"), "utf-8");
    writeFileSync(stderrLogPath, Array.from({ length: 50 }, (_, index) => `err-${index + 1}`).join("\n"), "utf-8");
    const task = fixture.store.getTask(fixture.task.task_id);
    task.raw_log_path = rawLogPath;
    task.stderr_log_path = stderrLogPath;
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({
      task_id: task.task_id,
      detail_level: "logs",
      log_tail_lines: 3,
      max_chars: 1000,
    });

    assert.strictEqual(result.detail_level, "logs");
    assert.deepStrictEqual(result.logs.stdout.split("\n"), ["out-48", "out-49", "out-50"]);
    assert.deepStrictEqual(result.logs.stderr.split("\n"), ["err-48", "err-49", "err-50"]);
    assert.strictEqual(result.logs.stdout.includes("out-1\n"), false);
    assert.strictEqual(result.logs.stderr.includes("err-1\n"), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("focused mode returns only explicitly requested files", async () => {
  const fixture = createTaskFixture("review-focused");
  try {
    mkdirSync(join(fixture.workspace, "src"), { recursive: true });
    writeFileSync(join(fixture.workspace, "src", "allowed.ts"), "export const allowed = true;\n", "utf-8");
    writeFileSync(join(fixture.workspace, "src", "secret.ts"), "export const secret = true;\n", "utf-8");

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({
      task_id: fixture.task.task_id,
      detail_level: "focused",
      file_paths: ["src/allowed.ts"],
      max_chars: 1000,
    });

    assert.strictEqual(result.detail_level, "focused");
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/allowed.ts");
    assert.match(result.files[0].content, /allowed = true/);
    assert.strictEqual(JSON.stringify(result).includes("secret = true"), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("full mode is available only when explicitly requested and remains budgeted", async () => {
  const fixture = createWorktreeFixture("review-full-explicit");
  try {
    const rawLogPath = join(fixture.root, "logs", `${fixture.task.task_id}.jsonl`);
    writeFileSync(rawLogPath, `${"full-log-line\n".repeat(100)}`, "utf-8");
    writeFileSync(join(fixture.info.worktreePath, "src", "example.ts"), "export const value = 2;\n", "utf-8");
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.raw_log_path = rawLogPath;
    task.modified_files = ["src/example.ts"];
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const defaultResult = await getTask.handler({ task_id: task.task_id });
    assert.strictEqual(defaultResult.detail_level, "review");
    assert.strictEqual("full" in defaultResult, false);

    const fullResult = await getTask.handler({
      task_id: task.task_id,
      detail_level: "full",
      max_chars: 4000,
      log_tail_lines: 5,
    });
    assert.strictEqual(fullResult.detail_level, "full");
    assert.ok(fullResult.task);
    assert.ok(fullResult.review_package);
    assert.ok(typeof fullResult.diff === "string");
    assert.ok(fullResult.logs.stdout.split("\n").length <= 5);
    assert.ok(fullResult.returned_chars <= 4000);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("review package derives changed files and line counts from Git", async () => {
  const fixture = createWorktreeFixture("review-git-summary");
  try {
    writeFileSync(
      join(fixture.info.worktreePath, "src", "example.ts"),
      "export const value = 1;\nexport const added = 2;\n",
      "utf-8"
    );
    writeFileSync(join(fixture.info.worktreePath, "src", "new.ts"), "export const created = true;\n", "utf-8");
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({ task_id: task.task_id, detail_level: "review" });
    const reviewPackage = result.review_package;

    assert.ok(reviewPackage.changed_files.includes("src/example.ts"));
    assert.ok(reviewPackage.changed_files.includes("src/new.ts"));
    assert.strictEqual(reviewPackage.changed_files_count, 2);
    assert.ok(reviewPackage.changed_lines_summary.some((entry) => entry.path === "src/example.ts" && entry.additions >= 1));
    assert.match(reviewPackage.diff_stat, /example\.ts/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("review package respects the total max_chars budget", async () => {
  const fixture = createTaskFixture("review-total-budget");
  try {
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.summary = "summary ".repeat(1000);
    task.modified_files = Array.from({ length: 150 }, (_, index) => `src/very-long-file-name-${index}.ts`);
    task.test_results = "npm.cmd test: passed\n" + "details ".repeat(500);
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({
      task_id: task.task_id,
      detail_level: "review",
      max_chars: 1200,
    });

    assert.ok(JSON.stringify(result.review_package).length <= 1200);
    assert.strictEqual(result.review_package.changed_files_count, 150);
    assert.strictEqual(result.review_package.truncated, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("focused evidence respects sub-budgets shorter than the truncation marker", () => {
  const fixture = createTaskFixture("review-tiny-sub-budget");
  try {
    mkdirSync(join(fixture.workspace, "src"), { recursive: true });
    writeFileSync(join(fixture.workspace, "src", "example.ts"), "long focused content", "utf-8");

    const [result] = getFocusedFiles(fixture.task, ["src/example.ts"], 1);

    assert.strictEqual(result.returned_chars, 1);
    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.truncated, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("focused mode rejects paths outside the task workspace", async () => {
  const fixture = createTaskFixture("review-focused-guard");
  try {
    writeFileSync(join(fixture.root, "outside.txt"), "outside\n", "utf-8");
    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({
      task_id: fixture.task.task_id,
      detail_level: "focused",
      file_paths: ["../outside.txt"],
      max_chars: 1000,
    });

    assert.match(result.error, /不允许包含|超出任务工作区/);
    assert.strictEqual("files" in result, false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("review mode includes only explicitly requested bounded artifacts", async () => {
  const fixture = createWorktreeFixture("review-explicit-includes");
  try {
    const rawLogPath = join(fixture.root, "logs", `${fixture.task.task_id}.jsonl`);
    writeFileSync(rawLogPath, "line-1\nline-2\nline-3\n", "utf-8");
    writeFileSync(join(fixture.info.worktreePath, "src", "example.ts"), "export const value = 3;\n", "utf-8");
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.raw_log_path = rawLogPath;
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({
      task_id: task.task_id,
      detail_level: "review",
      max_chars: 5000,
      log_tail_lines: 2,
      include_diff: true,
      include_logs: true,
      include_files: true,
      file_paths: ["src/example.ts"],
      diff_paths: ["src/example.ts"],
    });

    assert.ok(result.review_package);
    assert.ok(typeof result.diff === "string");
    assert.deepStrictEqual(result.logs.stdout.split("\n"), ["line-2", "line-3"]);
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, "src/example.ts");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("summary mode returns only minimal task state", async () => {
  const fixture = createTaskFixture("review-summary-minimal");
  try {
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.summary = "short summary";
    task.raw_log_path = "sensitive-log-path";
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({ task_id: task.task_id, detail_level: "summary" });

    assert.deepStrictEqual(Object.keys(result).sort(), ["completed", "detail_level", "status", "summary", "task_id"]);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(JSON.stringify(result).includes("sensitive-log-path"), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("review package includes objective_zh and mimo_summary_zh when content is Chinese", async () => {
  const fixture = createTaskFixture("review-zh-fields");
  try {
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.config.objective = "修复登录页面的中文显示问题";
    task.summary = "已修复登录页面，测试通过";
    task.modified_files = [];
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({ task_id: task.task_id, detail_level: "review" });

    assert.strictEqual(result.review_package.objective_zh, "修复登录页面的中文显示问题");
    assert.strictEqual(result.review_package.mimo_summary_zh, "已修复登录页面，测试通过");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("review package omits zh fields when content is English only", async () => {
  const fixture = createTaskFixture("review-no-zh-fields");
  try {
    const task = fixture.store.getTask(fixture.task.task_id);
    task.status = "review";
    task.config.objective = "fix login page rendering";
    task.summary = "Fixed the login page. Tests pass.";
    task.modified_files = [];
    fixture.store.saveTask(task);

    const getTask = createGetTaskHandler(fixture.store);
    const result = await getTask.handler({ task_id: task.task_id, detail_level: "review" });

    assert.strictEqual(result.review_package.objective_zh, undefined);
    assert.strictEqual(result.review_package.mimo_summary_zh, undefined);
    assert.strictEqual(result.review_package.objective, "fix login page rendering");
    assert.strictEqual(result.review_package.mimo_summary, "Fixed the login page. Tests pass.");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
