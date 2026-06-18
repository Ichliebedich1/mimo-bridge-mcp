import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-git-worktree");
const repoDir = join(testDir, "repo");

describe("git-worktree", () => {
  let GitWorktreeManager;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });

    execFileSync("git", ["init"], { cwd: repoDir, timeout: 10000 });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir, timeout: 5000 });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir, timeout: 5000 });

    writeFileSync(join(repoDir, "README.md"), "# Test\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoDir, timeout: 5000 });
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
    const manager = new GitWorktreeManager(repoDir);
    assert.strictEqual(manager.isGitRepo(), true);
  });

  it("isGitRepo should return false for non-git dir", () => {
    const nonGitDir = "C:\\Windows\\Temp\\test-non-git-temp-" + Date.now();
    mkdirSync(nonGitDir, { recursive: true });
    const manager = new GitWorktreeManager(nonGitDir);
    assert.strictEqual(manager.isGitRepo(), false);
    rmSync(nonGitDir, { recursive: true, force: true });
  });

  it("getCurrentCommit should return commit hash", () => {
    const manager = new GitWorktreeManager(repoDir);
    const commit = manager.getCurrentCommit();
    assert.ok(commit);
    assert.ok(commit.length === 40);
  });

  it("createWorktree should create worktree", () => {
    const manager = new GitWorktreeManager(repoDir);
    const info = manager.createWorktree("task_test001");

    assert.ok(info.taskId === "task_test001");
    assert.ok(info.worktreePath);
    assert.ok(info.branchName === "task/task_test001");
    assert.ok(info.baseCommit);
    assert.ok(existsSync(info.worktreePath));
  });

  it("createWorktree should throw for existing worktree", () => {
    const manager = new GitWorktreeManager(repoDir);
    assert.throws(() => {
      manager.createWorktree("task_test001");
    }, /Worktree 已存在/);
  });

  it("getChangedFiles should detect modifications", () => {
    const manager = new GitWorktreeManager(repoDir);
    const info = manager.createWorktree("task_test002");

    writeFileSync(join(info.worktreePath, "README.md"), "# Modified\n");
    writeFileSync(join(info.worktreePath, "new-file.txt"), "new content\n");

    const changed = manager.getChangedFiles("task_test002");
    assert.ok(changed.modified.includes("README.md") || changed.added.includes("new-file.txt"));
  });

  it("getDiffStat should return diff stat", () => {
    const manager = new GitWorktreeManager(repoDir);
    const stat = manager.getDiffStat("task_test002");
    assert.ok(typeof stat === "string");
  });

  it("checkOutOfBounds should detect out of bounds files", () => {
    const manager = new GitWorktreeManager(repoDir);
    const worktreePath = join(repoDir, ".worktrees", "task_test002");

    const outOfBounds = manager.checkOutOfBounds(
      worktreePath,
      ["src/allowed.ts", "src/not-allowed.ts", "README.md"],
      ["src/allowed.ts"]
    );

    assert.ok(outOfBounds.includes("src/not-allowed.ts"));
    assert.ok(outOfBounds.includes("README.md"));
    assert.ok(!outOfBounds.includes("src/allowed.ts"));
  });

  it("checkOutOfBounds should return empty for empty editablePaths", () => {
    const manager = new GitWorktreeManager(repoDir);
    const worktreePath = join(repoDir, ".worktrees", "task_test002");

    const outOfBounds = manager.checkOutOfBounds(
      worktreePath,
      ["src/any.ts"],
      []
    );

    assert.ok(outOfBounds.length === 0);
  });

  it("getDiffSummary should return summary", () => {
    const manager = new GitWorktreeManager(repoDir);
    const summary = manager.getDiffSummary("task_test002", ["README.md"]);

    assert.ok(summary.taskId === "task_test002");
    assert.ok(summary.worktreePath);
    assert.ok(Array.isArray(summary.modifiedFiles));
    assert.ok(Array.isArray(summary.addedFiles));
    assert.ok(Array.isArray(summary.deletedFiles));
    assert.ok(typeof summary.diffStat === "string");
    assert.ok(Array.isArray(summary.outOfBoundsFiles));
    assert.ok(typeof summary.hasOutOfBoundsChanges === "boolean");
  });

  it("removeWorktree should remove worktree", () => {
    const manager = new GitWorktreeManager(repoDir);
    manager.removeWorktree("task_test001");

    const worktreePath = join(repoDir, ".worktrees", "task_test001");
    assert.ok(!existsSync(worktreePath));
  });

  it("discardWorktree should remove worktree and branch", () => {
    const manager = new GitWorktreeManager(repoDir);
    manager.createWorktree("task_test003");
    manager.discardWorktree("task_test003");

    const worktreePath = join(repoDir, ".worktrees", "task_test003");
    assert.ok(!existsSync(worktreePath));
  });
});
