import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(tmpdir(), "test-git-worktree-" + Date.now());
const repoDir = join(testDir, "repo");
const runtimeDir = join(testDir, "runtime");

describe("git-worktree", () => {
  let GitWorktreeManager;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(join(repoDir, "src"), { recursive: true });

    execFileSync("git", ["init"], { cwd: repoDir, timeout: 10000 });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir, timeout: 5000 });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir, timeout: 5000 });

    writeFileSync(join(repoDir, "README.md"), "# Test\n");
    writeFileSync(join(repoDir, "src", "main.ts"), "console.log('hello');\n");
    execFileSync("git", ["add", "."], { cwd: repoDir, timeout: 5000 });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, timeout: 5000 });

    const module = await import("../dist/services/git-worktree.js");
    GitWorktreeManager = module.GitWorktreeManager;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("isGitRepo should return true for git repo", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    assert.strictEqual(manager.isGitRepo(), true);
  });

  it("isGitRepo should return false for non-git dir", () => {
    const nonGitDir = join(tmpdir(), "test-non-git-" + Date.now());
    mkdirSync(nonGitDir, { recursive: true });
    const manager = new GitWorktreeManager(nonGitDir, runtimeDir);
    assert.strictEqual(manager.isGitRepo(), false);
    rmSync(nonGitDir, { recursive: true, force: true });
  });

  it("getCurrentCommit should return commit hash", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const commit = manager.getCurrentCommit();
    assert.ok(commit);
    assert.ok(commit.length === 40);
  });

  it("getCurrentBranch should return branch name", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const branch = manager.getCurrentBranch();
    assert.ok(branch);
    assert.ok(branch.length > 0);
  });

  it("different repositories should use different runtime worktree roots", () => {
    const otherRepo = join(testDir, "repo-sibling");
    const first = new GitWorktreeManager(repoDir, runtimeDir);
    const second = new GitWorktreeManager(otherRepo, runtimeDir);

    assert.notStrictEqual(first.getWorktreesRoot(), second.getWorktreesRoot());
  });

  it("createWorktree should create worktree in runtime dir", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test001");

    assert.ok(info.taskId === "task_test001");
    assert.ok(info.worktreePath);
    assert.ok(info.branchName === "task/task_test001");
    assert.ok(info.baseCommit);
    assert.ok(existsSync(info.worktreePath));
    assert.ok(info.worktreePath.includes("worktrees"));
  });

  it("createWorktree should throw for existing worktree", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    assert.throws(() => {
      manager.createWorktree("task_test001");
    }, /Worktree 已存在/);
  });

  it("createWorktree should not pollute original repo", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    assert.strictEqual(status, "");
  });

  it("getChangedFiles should detect untracked files", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test002");

    writeFileSync(join(info.worktreePath, "new-file.txt"), "new content\n");

    const changed = manager.getChangedFiles("task_test002");
    assert.ok(changed.untracked.includes("new-file.txt"));
  });

  it("getChangedFiles should detect staged files", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test003");

    writeFileSync(join(info.worktreePath, "staged.txt"), "staged content\n");
    execFileSync("git", ["add", "staged.txt"], { cwd: info.worktreePath, timeout: 5000 });

    const changed = manager.getChangedFiles("task_test003");
    assert.ok(changed.added.includes("staged.txt"));
  });

  it("getChangedFiles should audit committed files against the saved base commit", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test004");

    writeFileSync(join(info.worktreePath, "committed.txt"), "committed content\n");
    execFileSync("git", ["add", "committed.txt"], { cwd: info.worktreePath, timeout: 5000 });
    execFileSync("git", ["commit", "-m", "add committed.txt"], { cwd: info.worktreePath, timeout: 5000 });

    const changed = manager.getChangedFiles("task_test004", info.baseCommit);
    assert.ok(changed.added.includes("committed.txt"));

    const summary = manager.getDiffSummary(
      "task_test004",
      ["README.md"],
      repoDir,
      info.baseCommit
    );
    assert.ok(summary.outOfBoundsFiles.includes("committed.txt"));
    assert.strictEqual(summary.hasOutOfBoundsChanges, true);
  });

  it("getChangedFiles should detect deleted files", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test005");

    execFileSync("git", ["rm", "README.md"], { cwd: info.worktreePath, timeout: 5000 });

    const changed = manager.getChangedFiles("task_test005");
    assert.ok(changed.deleted.includes("README.md"));
  });

  it("getChangedFiles should preserve renamed paths with spaces and unicode", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test005b");

    execFileSync("git", ["mv", "src/main.ts", "src/中文 file.ts"], {
      cwd: info.worktreePath,
      timeout: 5000,
    });

    const changed = manager.getChangedFiles("task_test005b", info.baseCommit);
    assert.ok(changed.deleted.includes("src/main.ts"));
    assert.ok(changed.added.includes("src/中文 file.ts"));
  });

  it("getDiffStat should return diff stat", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test006");
    writeFileSync(join(info.worktreePath, "stat-test.txt"), "test\n");

    const stat = manager.getDiffStat("task_test006", info.baseCommit);
    assert.ok(typeof stat === "string");
  });

  it("checkOutOfBounds should detect out of bounds files with relative paths", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const worktreePath = join(runtimeDir, "worktrees", "test", "task_test");

    const outOfBounds = manager.checkOutOfBounds(
      worktreePath,
      ["src/allowed.ts", "src/not-allowed.ts", "README.md"],
      ["src/allowed.ts"]
    );

    assert.ok(outOfBounds.includes("src/not-allowed.ts"));
    assert.ok(outOfBounds.includes("README.md"));
    assert.ok(!outOfBounds.includes("src/allowed.ts"));
  });

  it("checkOutOfBounds should handle absolute editable_paths", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const worktreePath = join(runtimeDir, "worktrees", "test", "task_test");
    const absoluteEditablePath = join(repoDir, "src", "allowed.ts");

    const outOfBounds = manager.checkOutOfBounds(
      worktreePath,
      ["src/allowed.ts", "other/file.ts"],
      [absoluteEditablePath],
      repoDir
    );

    assert.ok(!outOfBounds.includes("src/allowed.ts"));
    assert.ok(outOfBounds.includes("other/file.ts"));
  });

  it("checkOutOfBounds should return empty for empty editablePaths", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const worktreePath = join(runtimeDir, "worktrees", "test", "task_test");

    const outOfBounds = manager.checkOutOfBounds(
      worktreePath,
      ["src/any.ts"],
      []
    );

    assert.ok(outOfBounds.length === 0);
  });

  it("getDiffSummary should return summary", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test007");
    writeFileSync(join(info.worktreePath, "summary-test.txt"), "test\n");

    const summary = manager.getDiffSummary(
      "task_test007",
      ["README.md"],
      repoDir,
      info.baseCommit
    );

    assert.ok(summary.taskId === "task_test007");
    assert.ok(summary.worktreePath);
    assert.ok(Array.isArray(summary.modifiedFiles));
    assert.ok(Array.isArray(summary.addedFiles));
    assert.ok(summary.addedFiles.includes("summary-test.txt"));
    assert.ok(Array.isArray(summary.deletedFiles));
    assert.ok(typeof summary.diffStat === "string");
    assert.ok(Array.isArray(summary.outOfBoundsFiles));
    assert.ok(typeof summary.hasOutOfBoundsChanges === "boolean");
  });

  it("commitWorktreeChanges should commit changes", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test008");
    writeFileSync(join(info.worktreePath, "commit-test.txt"), "test\n");

    manager.commitWorktreeChanges("task_test008", "test commit");

    const log = execFileSync("git", ["log", "--oneline", "-1"], {
      cwd: info.worktreePath,
      encoding: "utf-8",
      timeout: 5000,
    });
    assert.ok(log.includes("test commit"));
  });

  it("mergeWorktree should merge committed changes", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test009");
    const currentBranch = manager.getCurrentBranch();

    writeFileSync(join(info.worktreePath, "merge-test.txt"), "merge content\n");
    manager.commitWorktreeChanges("task_test009", "mimo(task_test009): apply task changes");

    manager.mergeWorktree("task_test009", currentBranch);

    assert.ok(existsSync(join(repoDir, "merge-test.txt")));
  });

  it("mergeWorktree should handle merge conflicts", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    const info = manager.createWorktree("task_test010");
    const currentBranch = manager.getCurrentBranch();

    writeFileSync(join(info.worktreePath, "conflict.txt"), "worktree version\n");
    manager.commitWorktreeChanges("task_test010", "worktree change");

    writeFileSync(join(repoDir, "conflict.txt"), "main version\n");
    execFileSync("git", ["add", "conflict.txt"], { cwd: repoDir, timeout: 5000 });
    execFileSync("git", ["commit", "-m", "main change"], { cwd: repoDir, timeout: 5000 });

    assert.throws(() => {
      manager.mergeWorktree("task_test010", currentBranch);
    }, /合并冲突/);

    assert.ok(existsSync(info.worktreePath));
    assert.ok(existsSync(join(repoDir, ".git", "refs", "heads", "task", "task_test010")));
  });

  it("removeWorktree should remove worktree", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    manager.removeWorktree("task_test001");

    const worktreePath = join(runtimeDir, "worktrees", "task_test001");
    assert.ok(!existsSync(worktreePath));
  });

  it("discardWorktree should remove worktree and branch", () => {
    const manager = new GitWorktreeManager(repoDir, runtimeDir);
    manager.createWorktree("task_test011");
    manager.discardWorktree("task_test011");

    const worktreePath = join(runtimeDir, "worktrees", "task_test011");
    assert.ok(!existsSync(worktreePath));
  });
});
