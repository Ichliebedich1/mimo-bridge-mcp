import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";

export interface WorktreeInfo {
  taskId: string;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
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
    this.repoPath = repoPath;
    if (worktreesBaseDir) {
      const repoId = Buffer.from(repoPath).toString("base64url").slice(0, 12);
      this.worktreesDir = resolve(worktreesBaseDir, "worktrees", repoId);
    } else {
      this.worktreesDir = resolve(repoPath, ".worktrees");
    }
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
      worktreePath,
      branchName,
      baseCommit,
    };
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

  getChangedFiles(taskId: string): { modified: string[]; added: string[]; deleted: string[]; untracked: string[] } {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    const untracked: string[] = [];

    try {
      const statusOutput = execFileSync(
        "git",
        ["status", "--porcelain=v1", "-z"],
        {
          cwd: worktreePath,
          encoding: "utf-8",
          timeout: 30000,
        }
      );

      const entries = statusOutput.split("\0").filter((e) => e.length > 0);

      for (const entry of entries) {
        if (entry.length < 3) continue;

        const indexStatus = entry[0];
        const workTreeStatus = entry[1];
        const file = entry.substring(3);

        if (indexStatus === "?" && workTreeStatus === "?") {
          untracked.push(file);
        } else if (indexStatus === "R") {
          const parts = file.split(" -> ");
          if (parts.length === 2) {
            deleted.push(parts[0]);
            added.push(parts[1]);
          } else {
            modified.push(file);
          }
        } else if (indexStatus === "D" || workTreeStatus === "D") {
          deleted.push(file);
        } else if (indexStatus === "A" || workTreeStatus === "A") {
          added.push(file);
        } else if (indexStatus === "M" || workTreeStatus === "M" || indexStatus === "C") {
          modified.push(file);
        }
      }
    } catch (err) {
      throw new Error(`获取变更文件列表失败: ${err}`);
    }

    return { modified, added, deleted, untracked };
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

  getDiffSummary(taskId: string, editablePaths: string[], originalWorkspacePath?: string): DiffSummary {
    const worktreePath = resolve(this.worktreesDir, taskId);
    const changedFiles = this.getChangedFiles(taskId);

    const allChanged = [
      ...changedFiles.modified,
      ...changedFiles.added,
      ...changedFiles.deleted,
      ...changedFiles.untracked,
    ];

    const baseCommit = this.getBaseCommit(taskId);
    const diffStat = this.getDiffStat(taskId, baseCommit);

    const outOfBoundsFiles = this.checkOutOfBounds(worktreePath, allChanged, editablePaths, originalWorkspacePath);

    return {
      taskId,
      worktreePath,
      modifiedFiles: changedFiles.modified,
      addedFiles: changedFiles.added,
      deletedFiles: changedFiles.deleted,
      diffStat,
      outOfBoundsFiles,
      hasOutOfBoundsChanges: outOfBoundsFiles.length > 0,
    };
  }

  private getBaseCommit(taskId: string): string {
    try {
      const branchName = `task/${taskId}`;
      const output = execFileSync("git", ["log", "--format=%H", "--max-parents=0", branchName], {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      return output.split("\n")[0] || this.getCurrentCommit();
    } catch {
      return this.getCurrentCommit();
    }
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

  mergeWorktree(taskId: string, targetBranch: string): void {
    const worktreePath = resolve(this.worktreesDir, taskId);
    const branchName = `task/${taskId}`;

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
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
        execFileSync("git", ["merge", "--abort"], {
          cwd: this.repoPath,
          encoding: "utf-8",
          timeout: 10000,
        });
        throw new Error(`合并冲突，已中止合并: ${err}`);
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

  discardWorktree(taskId: string): void {
    const branchName = `task/${taskId}`;

    this.removeWorktree(taskId, true);

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
