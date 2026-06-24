import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import type { TaskResult, WorktreeState } from "../types.js";
import { validateWorkspacePath, validateEditablePaths, validateMaxRounds, validateTimeout } from "../services/path-guard.js";
import { writeTaskBrief } from "../services/prompt-builder.js";
import { runMimoTask } from "../services/mimo-runner.js";
import { globalRunningTasks, type RunningTaskRegistry } from "../services/running-tasks.js";
import { globalTaskQueue, type TaskQueue } from "../services/task-queue.js";
import { GitWorktreeManager } from "../services/git-worktree.js";
import { refreshReviewPackage } from "../services/review-package.js";
import { computeTaskScope } from "../services/task-scope.js";

type StartTaskRunner = (
  options: {
    mimoNodePath: string;
    mimoEntryPath: string;
    task: any;
    runtimeDir: string;
    timeoutMs: number;
  },
  onResult: (result: TaskResult) => void,
  onError: (error: string) => void
) => { cancel: () => void };

export interface StartTaskDependencies {
  runTask?: StartTaskRunner;
  runningTasks?: RunningTaskRegistry;
  taskQueue?: TaskQueue;
  agentId?: string;
}

export const StartTaskSchema = z.object({
  objective: z.string().min(1, "任务目标不能为空"),
  workspace_path: z.string().min(1, "工作区路径不能为空"),
  editable_paths: z.array(z.string()).default([]),
  readonly_paths: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  max_rounds: z.number().int().min(1).max(10).default(5),
  runtime_timeout_seconds: z.number().int().min(60).max(3600).default(900),
  use_worktree: z.boolean().default(false),
  priority: z.number().int().min(0).max(10).default(5),
  scope_mode: z.enum(["strict", "suggested", "repo-wide"]).default("strict"),
  include_tests: z.enum(["auto", "always", "never"]).default("auto"),
  repo_wide_confirmed: z.boolean().default(false),
  origin_codex_thread_id: z.string().optional(),
  origin_codex_thread_url: z.string().optional(),
  origin_source: z.string().optional(),
});

export type StartTaskInput = z.infer<typeof StartTaskSchema>;

export function createStartTaskHandler(
  config: Config,
  taskStore: TaskStore,
  dependencies: StartTaskDependencies = {}
) {
  const runTask = dependencies.runTask ?? runMimoTask;
  const runningTasks = dependencies.runningTasks ?? globalRunningTasks;
  const taskQueue = dependencies.taskQueue ?? globalTaskQueue;
  const agentId = dependencies.agentId ?? "mimo";

  function executeTask(
    taskId: string,
    taskConfig: any,
    worktreeState: WorktreeState | null,
    editablePaths: string[]
  ): Promise<void> {
    const task = taskStore.getTask(taskId);
    if (!task) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        runningTasks.unregister(taskId);
        resolve();
      };

      const complete = (result: TaskResult) => {
        if (settled) return;
        try {
          if (result.session_id) {
            taskStore.updateTaskSession(taskId, result.session_id);
          } else if (result.agent_session_path) {
            taskStore.updateTaskAgentSession(taskId, result.agent_session_path);
          }
          taskStore.updateTaskResult(taskId, result);
          taskStore.updateTaskStatus(taskId, result.status);

          if (worktreeState) {
            try {
              const gitManager = new GitWorktreeManager(task.config.workspace_path, config.runtimeDir);
              const summary = gitManager.getDiffSummaryForState(taskId, worktreeState, editablePaths);
              worktreeState = {
                ...worktreeState,
                diff_summary: summary.diffStat,
                out_of_bounds_files: summary.outOfBoundsFiles,
                has_out_of_bounds_changes: summary.hasOutOfBoundsChanges,
              };
              taskStore.updateTaskWorktree(taskId, worktreeState);
            } catch (err) {
              process.stderr.write(`[start-task] 获取 diff 摘要失败: ${err}\n`);
            }
          }
          refreshReviewPackage(taskStore, taskId);
        } finally {
          finish();
        }
      };

      const fail = (error: string) => {
        if (settled) return;
        try {
          taskStore.updateTaskStatus(taskId, "failed", error);
          refreshReviewPackage(taskStore, taskId);
        } finally {
          finish();
        }
      };

      try {
        const handle = runTask(
          {
            mimoNodePath: config.mimoNodePath,
            mimoEntryPath: config.mimoEntryPath,
            task: { ...task, config: taskConfig },
            runtimeDir: config.runtimeDir,
            timeoutMs: task.config.runtime_timeout_seconds * 1000,
          },
          complete,
          fail
        );

        if (!settled) {
          runningTasks.register(taskId, () => {
            handle.cancel();
            finish();
          });
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return {
    schema: StartTaskSchema,
    handler: async (input: StartTaskInput) => {
      const workspaceValidation = validateWorkspacePath(input.workspace_path, config.allowedRoots);
      if (!workspaceValidation.allowed) {
        return { error: workspaceValidation.reason };
      }

      const editableValidation = validateEditablePaths(input.editable_paths, input.workspace_path);
      if (!editableValidation.allowed) {
        return { error: editableValidation.reason };
      }

      const maxRoundsValidation = validateMaxRounds(input.max_rounds);
      if (!maxRoundsValidation.allowed) {
        return { error: maxRoundsValidation.reason };
      }

      const timeoutValidation = validateTimeout(input.runtime_timeout_seconds);
      if (!timeoutValidation.allowed) {
        return { error: timeoutValidation.reason };
      }

      const scopeResult = computeTaskScope({
        scope_mode: input.scope_mode,
        include_tests: input.include_tests,
        repo_wide_confirmed: input.repo_wide_confirmed,
        editable_paths: input.editable_paths,
        readonly_paths: input.readonly_paths,
        workspace_path: input.workspace_path,
        objective: input.objective,
      });
      if (!scopeResult.ok) {
        return { error: scopeResult.error };
      }

      const task = taskStore.createTask({
        objective: input.objective,
        workspace_path: input.workspace_path,
        editable_paths: scopeResult.effective_config.editable_paths,
        readonly_paths: scopeResult.effective_config.readonly_paths,
        acceptance_criteria: input.acceptance_criteria,
        max_rounds: input.max_rounds,
        runtime_timeout_seconds: input.runtime_timeout_seconds,
        scope: scopeResult.snapshot,
        origin_codex_thread_id: input.origin_codex_thread_id,
        origin_codex_thread_url: input.origin_codex_thread_url,
        origin_source: input.origin_source,
      }, { agent: agentId });

      let worktreePath = input.workspace_path;
      let worktreeState: WorktreeState | null = null;
      const gitManager = new GitWorktreeManager(input.workspace_path, config.runtimeDir);

      if (input.use_worktree) {
        if (!gitManager.isGitRepo()) {
          taskStore.updateTaskStatus(task.task_id, "failed", "use_worktree=true 但工作区不是 Git 仓库");
          return { error: "use_worktree=true 但工作区不是 Git 仓库" };
        }

        try {
          const worktreeInfo = gitManager.createWorktree(task.task_id);
          worktreePath = worktreeInfo.worktreePath;

          worktreeState = {
            repo_path: worktreeInfo.repoPath,
            worktrees_root: worktreeInfo.worktreesRoot,
            worktree_path: worktreeInfo.worktreePath,
            branch_name: worktreeInfo.branchName,
            base_commit: worktreeInfo.baseCommit,
            base_branch: worktreeInfo.baseBranch,
            diff_summary: null,
            out_of_bounds_files: [],
            has_out_of_bounds_changes: false,
          };

          taskStore.updateTaskWorktree(task.task_id, worktreeState);
        } catch (err) {
          taskStore.updateTaskStatus(task.task_id, "failed", `创建 Worktree 失败: ${err}`);
          return { error: `创建 Worktree 失败: ${err}` };
        }
      }

      const taskConfig = { ...task.config, workspace_path: worktreePath };
      writeTaskBrief(taskConfig, task.task_id, task.current_round, `${config.runtimeDir}/briefs`);

      const taskId = task.task_id;
      const editablePaths = scopeResult.effective_config.editable_paths;

      const startedImmediately = taskQueue.enqueue({
        taskId,
        agentId,
        workspacePath: input.workspace_path,
        editablePaths,
        priority: input.priority,
        enqueuedAt: Date.now(),
        execute: async () => {
          taskStore.updateTaskStatus(taskId, "running");
          await executeTask(taskId, taskConfig, worktreeState, editablePaths);
        },
        cancel: () => {
          if (worktreeState) {
            const queuedWorktree = worktreeState;
            const queuedGitManager = GitWorktreeManager.fromWorktreeState(queuedWorktree);
            queuedGitManager.assertWorktreeState(taskId, queuedWorktree);
            queuedGitManager.discardWorktree(taskId, queuedWorktree.branch_name);
            taskStore.clearTaskWorktree(taskId);
            worktreeState = null;
          }
          taskStore.updateTaskStatus(taskId, "cancelled");
        },
      });

      if (!startedImmediately) {
        taskStore.updateTaskStatus(taskId, "queued");
        return {
          task_id: taskId,
          status: "queued",
          queue_position: taskQueue.size,
        };
      }

      return {
        task_id: taskId,
        status: "running",
        worktree_path: worktreePath,
      };
    },
    cancelTask: (taskId: string) => {
      if (taskQueue.cancel(taskId)) {
        return true;
      }
      return runningTasks.cancel(taskId);
    },
    getQueueStatus: () => {
      return {
        running: runningTasks.size,
        queued: taskQueue.size,
        queue: taskQueue.getQueuedTasks(),
      };
    },
  };
}
