import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { WorktreeState } from "../types.js";

export interface WorktreeInfo {
  taskId: string;
  repoPath: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
  baseBranch: string;
}

export interface DiffSummary {
  taskId: string;
  worktreePath: string;
  modifiedFiles: string[];
  addedFiles: string[];
  deletedFiles: string[];
  diffStat: string;
  outOfBoundsFiles: string[];
  hasOutOfBoundsChanges: boolean;
}

export class GitWorktreeManager {
  private repoPath: string;
  private worktreesDir: string;

  constructor(repoPath: string, worktreesBaseDir?: string) {
    this.repoPath = resolve(repoPath);
    if (worktreesBaseDir) {
      const repoIdentity = process.platform === "win32" ? this.repoPath.toLowerCase() : this.repoPath;
      const repoId = createHash("sha256").update(repoIdentity).digest("hex").slice(0, 16);
      this.worktreesDir = resolve(worktreesBaseDir, "worktrees", repoId);
    } else {
      this.worktreesDir = resolve(repoPath, ".worktrees");
    }
  }

  static fromWorktreeState(state: WorktreeState): GitWorktreeManager {
    const manager = new GitWorktreeManager(state.repo_path);
    manager.worktreesDir = resolve(state.worktrees_root);
    return manager;
  }

  getWorktreesRoot(): string {
    return this.worktreesDir;
  }

  isGitRepo(): boolean {
    try {
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  getCurrentCommit(): string {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: this.repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  }

  getCurrentBranch(): string {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: this.repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  }

  createWorktree(taskId: string): WorktreeInfo {
    if (!this.isGitRepo()) {
      throw new Error(`路径不是 Git 仓库: ${this.repoPath}`);
    }

    const branchName = `task/${taskId}`;
    const worktreePath = resolve(this.worktreesDir, taskId);
    const baseCommit = this.getCurrentCommit();
    const baseBranch = this.getCurrentBranch();

    if (!existsSync(this.worktreesDir)) {
      mkdirSync(this.worktreesDir, { recursive: true });
    }

    if (existsSync(worktreePath)) {
      throw new Error(`Worktree 已存在: ${worktreePath}`);
    }

    try {
      execFileSync(
        "git",
        ["worktree", "add", "-b", branchName, worktreePath, baseCommit],
        {
          cwd: this.repoPath,
          encoding: "utf-8",
          timeout: 30000,
        }
      );
    } catch (err) {
      throw new Error(`创建 Worktree 失败: ${err}`);
    }

    return {
      taskId,
      repoPath: this.repoPath,
      worktreesRoot: this.worktreesDir,
      worktreePath,
      branchName,
      baseCommit,
      baseBranch,
    };
  }

  assertWorktreeState(taskId: string, state: WorktreeState): void {
    if (!state.repo_path || !state.worktrees_root || !state.base_branch) {
      throw new Error("Worktree 状态缺少 repo_path、worktrees_root 或 base_branch");
    }

    const repoPath = this.realPath(state.repo_path, "原仓库");
    const managerRepoPath = this.realPath(this.repoPath, "Manager 原仓库");
    if (!this.samePath(repoPath, managerRepoPath)) {
      throw new Error("Worktree 状态中的原仓库与 Manager 不一致");
    }

    if (state.branch_name !== `task/${taskId}`) {
      throw new Error("Worktree 分支名与任务 ID 不匹配");
    }

    const worktreesRoot = this.realPath(state.worktrees_root, "Worktree 根目录");
    const managerRoot = this.realPath(this.worktreesDir, "Manager Worktree 根目录");
    if (!this.samePath(worktreesRoot, managerRoot)) {
      throw new Error("Worktree 状态中的根目录与 Manager 不一致");
    }

    const worktreePath = this.realPath(state.worktree_path, "Worktree");
    const rel = relative(worktreesRoot, worktreePath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Worktree 路径不在保存的根目录内");
    }

    const expectedPath = this.realPath(resolve(worktreesRoot, taskId), "任务 Worktree");
    if (!this.samePath(worktreePath, expectedPath)) {
      throw new Error("Worktree 路径与任务 ID 不匹配");
    }

    const repoCommonDir = this.getGitCommonDir(repoPath);
    const worktreeCommonDir = this.getGitCommonDir(worktreePath);
    if (!this.samePath(repoCommonDir, worktreeCommonDir)) {
      throw new Error("Worktree 不属于任务原仓库");
    }

    const actualBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (actualBranch !== state.branch_name) {
      throw new Error(`Worktree 分支不匹配: ${actualBranch}`);
    }

    try {
      execFileSync("git", ["check-ref-format", "--branch", state.base_branch], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5000,
      });
      execFileSync("git", ["show-ref", "--verify", `refs/heads/${state.base_branch}`], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5000,
      });
      execFileSync("git", ["merge-base", "--is-ancestor", state.base_commit, state.branch_name], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5000,
      });
      execFileSync("git", ["merge-base", "--is-ancestor", state.base_commit, state.base_branch], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5000,
      });
    } catch {
      throw new Error("保存的基线提交或基线分支无效");
    }
  }

  getDiffSummaryForState(
    taskId: string,
    state: WorktreeState,
    editablePaths: string[]
  ): DiffSummary {
    this.assertWorktreeState(taskId, state);
    return this.getDiffSummary(taskId, editablePaths, state.repo_path, state.base_commit);
  }

  private realPath(path: string, label: string): string {
    try {
      return realpathSync(path);
    } catch {
      throw new Error(`${label}不存在或无法解析: ${path}`);
    }
  }

  private samePath(left: string, right: string): boolean {
    if (process.platform === "win32") {
      return left.toLowerCase() === right.toLowerCase();
    }
    return left === right;
  }

  private getGitCommonDir(cwd: string): string {
    try {
      const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      return realpathSync(resolve(cwd, commonDir));
    } catch (err) {
      throw new Error(`无法验证 Git 仓库归属: ${err}`);
    }
  }

  removeWorktree(taskId: string, force: boolean = false): void {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      return;
    }

    try {
      const args = ["worktree", "remove"];
      if (force) {
        args.push("--force");
      }
      args.push(worktreePath);

      execFileSync("git", args, {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch (err) {
      if (!force) {
        throw new Error(`删除 Worktree 失败: ${err}`);
      }
    }
  }

  getChangedFiles(
    taskId: string,
    baseCommit: string = "HEAD"
  ): { modified: string[]; added: string[]; deleted: string[]; untracked: string[] } {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    const modified = new Set<string>();
    const added = new Set<string>();
    const deleted = new Set<string>();
    const untracked = new Set<string>();

    try {
      const diffOutput = execFileSync(
        "git",
        ["diff", "--name-status", "--find-renames", "-z", baseCommit],
        {
          cwd: worktreePath,
          encoding: "utf-8",
          timeout: 30000,
        }
      );

      const tokens = diffOutput.split("\0");
      let index = 0;
      while (index < tokens.length) {
        const status = tokens[index++];
        if (!status) continue;

        if (status.startsWith("R")) {
          const oldPath = tokens[index++];
          const newPath = tokens[index++];
          if (oldPath) deleted.add(oldPath);
          if (newPath) added.add(newPath);
          continue;
        }

        if (status.startsWith("C")) {
          index += 1;
          const newPath = tokens[index++];
          if (newPath) added.add(newPath);
          continue;
        }

        const file = tokens[index++];
        if (!file) continue;

        switch (status[0]) {
          case "A":
            added.add(file);
            break;
          case "D":
            deleted.add(file);
            break;
          default:
            modified.add(file);
        }
      }

      const untrackedOutput = execFileSync(
        "git",
        ["ls-files", "--others", "--exclude-standard", "-z"],
        {
          cwd: worktreePath,
          encoding: "utf-8",
          timeout: 30000,
        }
      );
      for (const file of untrackedOutput.split("\0")) {
        if (file) untracked.add(file);
      }
    } catch (err) {
      throw new Error(`获取变更文件列表失败: ${err}`);
    }

    return {
      modified: [...modified],
      added: [...added],
      deleted: [...deleted],
      untracked: [...untracked],
    };
  }

  getDiff(taskId: string, baseCommit: string): string {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    try {
      let diff = "";

      try {
        diff += execFileSync("git", ["diff", "--no-color", `${baseCommit}..HEAD`], {
          cwd: worktreePath,
          encoding: "utf-8",
          timeout: 30000,
        });
      } catch {
        // No commits after base
      }

      diff += execFileSync("git", ["diff", "--no-color", "--cached"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30000,
      });

      diff += execFileSync("git", ["diff", "--no-color"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30000,
      });

      return diff;
    } catch (err) {
      throw new Error(`获取 diff 失败: ${err}`);
    }
  }

  getDiffStat(taskId: string, baseCommit: string): string {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    try {
      let stat = "";

      try {
        stat += execFileSync("git", ["diff", "--stat", "--no-color", `${baseCommit}..HEAD`], {
          cwd: worktreePath,
          encoding: "utf-8",
          timeout: 30000,
        });
      } catch {
        // No commits after base
      }

      stat += execFileSync("git", ["diff", "--stat", "--no-color", "--cached"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30000,
      });

      stat += execFileSync("git", ["diff", "--stat", "--no-color"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30000,
      });

      return stat;
    } catch (err) {
      throw new Error(`获取 diff stat 失败: ${err}`);
    }
  }

  getChangedLinesSummary(
    taskId: string,
    baseCommit: string
  ): Array<{ path: string; additions: number | null; deletions: number | null }> {
    const worktreePath = resolve(this.worktreesDir, taskId);
    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    try {
      const output = execFileSync("git", ["diff", "--numstat", "-z", baseCommit], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30000,
      });
      const results: Array<{ path: string; additions: number | null; deletions: number | null }> = [];
      for (const record of output.split("\0")) {
        if (!record) continue;
        const firstTab = record.indexOf("\t");
        const secondTab = firstTab >= 0 ? record.indexOf("\t", firstTab + 1) : -1;
        if (firstTab < 0 || secondTab < 0) continue;
        const additions = record.slice(0, firstTab);
        const deletions = record.slice(firstTab + 1, secondTab);
        const path = record.slice(secondTab + 1);
        if (!path) continue;
        results.push({
          path,
          additions: additions === "-" ? null : Number(additions),
          deletions: deletions === "-" ? null : Number(deletions),
        });
      }
      return results;
    } catch (err) {
      throw new Error(`获取变更行摘要失败: ${err}`);
    }
  }

  getDiffSummary(
    taskId: string,
    editablePaths: string[],
    originalWorkspacePath?: string,
    baseCommit: string = "HEAD"
  ): DiffSummary {
    const worktreePath = resolve(this.worktreesDir, taskId);
    const changedFiles = this.getChangedFiles(taskId, baseCommit);

    const allChanged = [
      ...changedFiles.modified,
      ...changedFiles.added,
      ...changedFiles.deleted,
      ...changedFiles.untracked,
    ];

    let diffStat = this.getDiffStat(taskId, baseCommit);
    if (changedFiles.untracked.length > 0) {
      const untrackedLines = changedFiles.untracked.map((file) => ` ${file} | untracked`).join("\n");
      diffStat += `${diffStat && !diffStat.endsWith("\n") ? "\n" : ""}${untrackedLines}\n`;
    }

    const outOfBoundsFiles = this.checkOutOfBounds(worktreePath, allChanged, editablePaths, originalWorkspacePath);

    return {
      taskId,
      worktreePath,
      modifiedFiles: changedFiles.modified,
      addedFiles: [...new Set([...changedFiles.added, ...changedFiles.untracked])],
      deletedFiles: changedFiles.deleted,
      diffStat,
      outOfBoundsFiles,
      hasOutOfBoundsChanges: outOfBoundsFiles.length > 0,
    };
  }

  checkOutOfBounds(
    worktreePath: string,
    changedFiles: string[],
    editablePaths: string[],
    originalWorkspacePath?: string
  ): string[] {
    if (editablePaths.length === 0) {
      return [];
    }

    const outOfBounds: string[] = [];

    const relativeEditablePaths = editablePaths.map((p) => {
      if (isAbsolute(p) && originalWorkspacePath) {
        return relative(originalWorkspacePath, p).replace(/\\/g, "/");
      }
      return p.replace(/\\/g, "/");
    });

    for (const file of changedFiles) {
      const normalizedFile = file.replace(/\\/g, "/");

      const isEditable = relativeEditablePaths.some((editablePath) => {
        if (normalizedFile === editablePath) {
          return true;
        }
        if (normalizedFile.startsWith(editablePath + "/")) {
          return true;
        }
        return false;
      });

      if (!isEditable) {
        outOfBounds.push(file);
      }
    }

    return outOfBounds;
  }

  commitWorktreeChanges(taskId: string, message: string): void {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    try {
      execFileSync("git", ["add", "-A"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30000,
      });

      execFileSync("git", ["commit", "-m", message, "--allow-empty"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch (err) {
      throw new Error(`提交 Worktree 修改失败: ${err}`);
    }
  }

  isRepoClean(): boolean {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd: this.repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    return output.length === 0;
  }

  getRepoStatusSnapshot(): string {
    return execFileSync("git", ["status", "--porcelain=v1", "-z"], {
      cwd: this.repoPath,
      encoding: "utf-8",
      timeout: 5000,
    });
  }

  mergeWorktree(taskId: string, targetBranch: string, branchName: string = `task/${taskId}`): void {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    if (!this.isRepoClean()) {
      throw new Error("原仓库工作区存在未提交修改，不能自动合并");
    }

    try {
      const hasChanges = this.hasUncommittedChanges(worktreePath);
      if (hasChanges) {
        this.commitWorktreeChanges(taskId, `mimo(${taskId}): apply task changes`);
      }

      execFileSync("git", ["checkout", targetBranch], {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 30000,
      });

      try {
        execFileSync("git", ["merge", "--no-ff", branchName], {
          cwd: this.repoPath,
          encoding: "utf-8",
          timeout: 30000,
        });
      } catch (err) {
        let abortError = "";
        try {
          execFileSync("git", ["merge", "--abort"], {
            cwd: this.repoPath,
            encoding: "utf-8",
            timeout: 10000,
          });
        } catch (abortErr) {
          abortError = `；中止合并也失败: ${abortErr}`;
        }
        throw new Error(`合并冲突，已中止合并: ${err}${abortError}`);
      }
    } catch (err) {
      throw new Error(`合并 Worktree 失败: ${err}`);
    }
  }

  private hasUncommittedChanges(worktreePath: string): boolean {
    try {
      const output = execFileSync("git", ["status", "--porcelain"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      return output.length > 0;
    } catch {
      return false;
    }
  }

  discardWorktree(taskId: string, branchName: string = `task/${taskId}`): void {
    this.removeWorktree(taskId, true);
    this.pruneWorktrees();

    this.deleteBranch(branchName);
  }

  pruneWorktrees(): void {
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch {
      // Prune is best-effort cleanup for stale worktree metadata.
    }
  }

  deleteBranch(branchName: string): void {
    try {
      execFileSync("git", ["branch", "-D", branchName], {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch {
      // Branch may not exist
    }
  }
}
