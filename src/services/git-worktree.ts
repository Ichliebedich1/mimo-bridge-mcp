import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

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

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.worktreesDir = resolve(repoPath, ".worktrees");
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

  getDiff(taskId: string): string {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    try {
      return execFileSync("git", ["diff", "--no-color"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch (err) {
      throw new Error(`获取 diff 失败: ${err}`);
    }
  }

  getDiffStat(taskId: string): string {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    try {
      return execFileSync("git", ["diff", "--stat", "--no-color"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch (err) {
      throw new Error(`获取 diff stat 失败: ${err}`);
    }
  }

  getChangedFiles(taskId: string): { modified: string[]; added: string[]; deleted: string[] } {
    const worktreePath = resolve(this.worktreesDir, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    try {
      const output = execFileSync(
        "git",
        ["diff", "--name-status", "--no-color"],
        {
          cwd: worktreePath,
          encoding: "utf-8",
          timeout: 30000,
        }
      );

      const modified: string[] = [];
      const added: string[] = [];
      const deleted: string[] = [];

      for (const line of output.split("\n")) {
        if (!line.trim()) continue;
        const [status, file] = line.split("\t");
        if (!file) continue;

        switch (status) {
          case "M":
            modified.push(file);
            break;
          case "A":
            added.push(file);
            break;
          case "D":
            deleted.push(file);
            break;
          case "R100":
          case "R":
            modified.push(file);
            break;
        }
      }

      return { modified, added, deleted };
    } catch (err) {
      throw new Error(`获取变更文件列表失败: ${err}`);
    }
  }

  getDiffSummary(taskId: string, editablePaths: string[]): DiffSummary {
    const worktreePath = resolve(this.worktreesDir, taskId);
    const changedFiles = this.getChangedFiles(taskId);
    const diffStat = this.getDiffStat(taskId);

    const allChanged = [
      ...changedFiles.modified,
      ...changedFiles.added,
      ...changedFiles.deleted,
    ];

    const outOfBoundsFiles = this.checkOutOfBounds(worktreePath, allChanged, editablePaths);

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

  checkOutOfBounds(
    worktreePath: string,
    changedFiles: string[],
    editablePaths: string[]
  ): string[] {
    if (editablePaths.length === 0) {
      return [];
    }

    const outOfBounds: string[] = [];

    for (const file of changedFiles) {
      const absoluteFile = resolve(worktreePath, file);
      const isEditable = editablePaths.some((editablePath) => {
        const absoluteEditable = resolve(worktreePath, editablePath);
        return absoluteFile === absoluteEditable || absoluteFile.startsWith(absoluteEditable + "\\") || absoluteFile.startsWith(absoluteEditable + "/");
      });

      if (!isEditable) {
        outOfBounds.push(file);
      }
    }

    return outOfBounds;
  }

  mergeWorktree(taskId: string, targetBranch: string = "master"): void {
    const worktreePath = resolve(this.worktreesDir, taskId);
    const branchName = `task/${taskId}`;

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree 不存在: ${worktreePath}`);
    }

    try {
      execFileSync("git", ["checkout", targetBranch], {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 30000,
      });

      execFileSync("git", ["merge", "--no-ff", branchName], {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch (err) {
      throw new Error(`合并 Worktree 失败: ${err}`);
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
