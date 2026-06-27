import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import type { TaskAttachment, TaskAttachmentInput, TaskConfig, TaskResult, TaskState, WorktreeState } from "../types.js";
import { validateSessionId } from "../services/path-guard.js";
import { writeReplyBrief } from "../services/prompt-builder.js";
import { persistTaskAttachments } from "../services/task-attachments.js";
import { runMimoTask } from "../services/mimo-runner.js";
import { resolveRouting } from "../services/model-routing.js";
import { globalRunningTasks, type RunningTaskRegistry } from "../services/running-tasks.js";
import { globalTaskQueue, type TaskQueue } from "../services/task-queue.js";
import { refreshReviewPackage } from "../services/review-package.js";
import { GitWorktreeManager } from "../services/git-worktree.js";

type ReplyTaskRunner = (
  options: {
    mimoNodePath: string;
    mimoEntryPath: string;
    task: TaskState;
    runtimeDir: string;
    timeoutMs: number;
  },
  onResult: (result: TaskResult) => void,
  onError: (error: string) => void
) => { cancel: () => void };

export interface ReplyTaskDependencies {
  runTask?: ReplyTaskRunner;
  runningTasks?: RunningTaskRegistry;
  taskQueue?: TaskQueue;
  agentId?: string;
  validateReplyTarget?: (task: TaskState) => string | null;
}

interface ReplyExecutionContext {
  taskConfig: TaskConfig;
  worktreeState: WorktreeState | null;
  gitManager: GitWorktreeManager | null;
}

function resolveReplyExecutionContext(taskId: string, task: TaskState): ReplyExecutionContext {
  const worktreeState = task.worktree;
  if (!worktreeState) {
    return {
      taskConfig: task.config,
      worktreeState: null,
      gitManager: null,
    };
  }

  const gitManager = GitWorktreeManager.fromWorktreeState(worktreeState);
  gitManager.assertWorktreeState(taskId, worktreeState);

  return {
    taskConfig: { ...task.config, workspace_path: worktreeState.worktree_path },
    worktreeState,
    gitManager,
  };
}

function buildBlockedWorktreeReplyError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Invalid Worktree state; blocked follow-up reply before spawning MiMo: ${detail}`;
}

function markMainRepoMutationDuringReply(result: TaskResult): TaskResult {
  const warning =
    "Original repository status changed while a Worktree follow-up was running; blocking review because the agent may have edited the main repository.";
  return {
    ...result,
    status: "failed",
    error: result.error ? `${result.error}; ${warning}` : warning,
    issues: [...result.issues, warning],
  };
}

export const ReplyTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
  message: z.string().min(1, "回复消息不能为空"),
  priority: z.number().int().min(0).max(10).default(5),
  routing_mode: z.enum(["auto", "manual"]).optional(),
  task_scenario: z.enum(["multimodal", "simple", "normal", "complex", "high_risk"]).optional(),
  model: z.string().optional(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
  has_images: z.boolean().default(false),
  attachments: z.array(z.object({
    name: z.string().min(1).max(160),
    mime_type: z.string().optional(),
    size_bytes: z.number().int().min(0).optional(),
    base64: z.string().min(1),
    kind: z.enum(["image", "file"]).optional(),
  })).default([]),
});

export type ReplyTaskInput = z.infer<typeof ReplyTaskSchema>;

export function createReplyTaskHandler(
  config: Config,
  taskStore: TaskStore,
  dependencies: ReplyTaskDependencies = {}
) {
  const runTask = dependencies.runTask ?? runMimoTask;
  const runningTasks = dependencies.runningTasks ?? globalRunningTasks;
  const taskQueue = dependencies.taskQueue ?? globalTaskQueue;
  const expectedAgentId = dependencies.agentId;
  const validateReplyTarget = dependencies.validateReplyTarget ?? validateMimoReplyTarget;

  function executeReply(taskId: string): Promise<void> {
    const task = taskStore.getTask(taskId);
    if (!task) return Promise.resolve();

    let executionContext: ReplyExecutionContext;
    try {
      executionContext = resolveReplyExecutionContext(taskId, task);
    } catch (err) {
      const error = buildBlockedWorktreeReplyError(err);
      taskStore.updateTaskStatus(taskId, "failed", error);
      refreshReviewPackage(taskStore, taskId);
      return Promise.resolve();
    }

    const { taskConfig, gitManager } = executionContext;
    let worktreeState = executionContext.worktreeState;
    let originalRepoStatusBefore: string | null = null;
    if (gitManager) {
      try {
        originalRepoStatusBefore = gitManager.getRepoStatusSnapshot();
      } catch (err) {
        const error = buildBlockedWorktreeReplyError(err);
        taskStore.updateTaskStatus(taskId, "failed", error);
        refreshReviewPackage(taskStore, taskId);
        return Promise.resolve();
      }
    }

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
          let resultToStore = result;
          if (gitManager && originalRepoStatusBefore !== null) {
            const originalRepoStatusAfter = gitManager.getRepoStatusSnapshot();
            if (originalRepoStatusAfter !== originalRepoStatusBefore) {
              resultToStore = markMainRepoMutationDuringReply(result);
            }
          }

          if (resultToStore.session_id) {
            taskStore.updateTaskSession(taskId, resultToStore.session_id);
          } else if (resultToStore.agent_session_path) {
            taskStore.updateTaskAgentSession(taskId, resultToStore.agent_session_path);
          }
          taskStore.updateTaskResult(taskId, resultToStore);
          taskStore.updateTaskStatus(taskId, resultToStore.status);

          if (worktreeState) {
            try {
              const worktreeGitManager = GitWorktreeManager.fromWorktreeState(worktreeState);
              const summary = worktreeGitManager.getDiffSummaryForState(
                taskId,
                worktreeState,
                task.config.editable_paths
              );
              worktreeState = {
                ...worktreeState,
                diff_summary: summary.diffStat,
                out_of_bounds_files: summary.outOfBoundsFiles,
                has_out_of_bounds_changes: summary.hasOutOfBoundsChanges,
              };
              taskStore.updateTaskWorktree(taskId, worktreeState);
            } catch (err) {
              process.stderr.write(`[reply-task] failed to collect diff summary: ${err}\n`);
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
    schema: ReplyTaskSchema,
    handler: async (input: ReplyTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      if (expectedAgentId && task.agent !== expectedAgentId) {
        return { error: `Task ${task.task_id} belongs to agent ${task.agent}, not ${expectedAgentId}` };
      }

      if (task.status !== "waiting" && task.status !== "review" && task.status !== "queued" && task.status !== "failed") {
        return { error: `任务状态不允许回复: ${task.status}` };
      }

      const targetError = validateReplyTarget(task);
      if (targetError) {
        return { error: targetError };
      }

      if (task.current_round > task.config.max_rounds) {
        return { error: `已达到最大沟通轮数 ${task.config.max_rounds}` };
      }

      try {
        resolveReplyExecutionContext(task.task_id, task);
      } catch (err) {
        return { error: buildBlockedWorktreeReplyError(err) };
      }

      if (taskQueue.hasQueued(task.task_id)) {
        return { error: `任务回复已在队列中: ${task.task_id}` };
      }

      const persistedAttachments = persistReplyAttachments(config.runtimeDir, task.task_id, input.attachments);
      if (!persistedAttachments.ok) {
        return { error: persistedAttachments.error };
      }
      const routing = resolveReplyRouting(task, input, config.routingProfiles, persistedAttachments.attachments);
      if (!routing.ok) {
        return { error: routing.error };
      }
      if (routing.config) {
        task.config.routing = routing.config;
        taskStore.saveTask(task);
      }
      writeReplyBrief(
        buildReplyMessageWithAttachments(input.message, persistedAttachments.attachments),
        task.task_id,
        task.current_round,
        `${config.runtimeDir}/briefs`,
        task.config.routing
      );

      const taskId = task.task_id;

      const startedImmediately = taskQueue.enqueue({
        taskId,
        agentId: task.agent,
        workspacePath: task.config.workspace_path,
        editablePaths: task.config.editable_paths,
        priority: input.priority,
        enqueuedAt: Date.now(),
        execute: async () => {
          taskStore.updateTaskStatus(taskId, "running");
          await executeReply(taskId);
        },
        cancel: () => {
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
      };
    },
    cancelTask: (taskId: string) => {
      if (taskQueue.cancel(taskId)) {
        return true;
      }
      return runningTasks.cancel(taskId);
    },
  };
}

function validateMimoReplyTarget(task: TaskState): string | null {
  if (!task.session_id) {
    return "任务没有 MiMo 会话 ID，无法回复";
  }

  const sessionValidation = validateSessionId(task.session_id);
  if (!sessionValidation.allowed) {
    return sessionValidation.reason ?? "Invalid MiMo session ID";
  }
  return null;
}

function resolveReplyRouting(
  task: TaskState,
  input: ReplyTaskInput,
  routingProfiles: Config["routingProfiles"],
  attachments: TaskAttachment[]
): { ok: true; config: TaskState["config"]["routing"] | null } | { ok: false; error: string } {
  const hasImages = input.has_images || attachments.some((attachment) => attachment.kind === "image");
  const hasOverride = input.routing_mode !== undefined ||
    input.task_scenario !== undefined ||
    input.model !== undefined ||
    input.reasoning_effort !== undefined ||
    hasImages;
  if (!hasOverride) {
    return { ok: true, config: task.config.routing ?? null };
  }

  const agentKind = task.agent === "mimo" || task.agent === "reasonix-tui" ? task.agent : "unknown";
  const result = resolveRouting(agentKind, {
    routing_mode: input.routing_mode ?? (input.model || input.reasoning_effort ? "manual" : task.config.routing?.routing_mode),
    task_scenario: input.task_scenario ?? task.config.routing?.task_scenario,
    model: input.model,
    reasoning_effort: input.reasoning_effort,
    has_images: hasImages,
  }, routingProfiles);
  if (!result.ok) {
    return result;
  }
  return { ok: true, config: result.config };
}

function persistReplyAttachments(
  runtimeDir: string,
  taskId: string,
  attachments: TaskAttachmentInput[] | undefined
): { ok: true; attachments: TaskAttachment[] } | { ok: false; error: string } {
  return persistTaskAttachments(runtimeDir, taskId, attachments);
}

function buildReplyMessageWithAttachments(message: string, attachments: TaskAttachment[]): string {
  if (attachments.length === 0) {
    return message;
  }
  const lines = [
    message,
    "",
    "## Reply attachments",
    "",
    "MiMo Bridge saved these reply attachments under the task runtime directory. Read them if needed; do not rely on browser-local original paths.",
    "",
    ...attachments.map((attachment) => `- \`${attachment.path}\` (${attachment.name}, ${attachment.mime_type}, ${attachment.size_bytes} bytes, ${attachment.kind})`),
  ];
  return lines.join("\n");
}
