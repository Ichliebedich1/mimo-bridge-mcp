import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import type { AgentKind, TaskErrorDetail, TaskResult, WorktreeState } from "../types.js";
import { validateWorkspacePath, validateEditablePaths, validateMaxRounds, validateTimeout } from "../services/path-guard.js";
import { writeTaskBrief } from "../services/prompt-builder.js";
import { runMimoTask } from "../services/mimo-runner.js";
import { globalRunningTasks, type RunningTaskRegistry } from "../services/running-tasks.js";
import { globalTaskQueue, type TaskQueue } from "../services/task-queue.js";
import { GitWorktreeManager } from "../services/git-worktree.js";
import { refreshReviewPackage } from "../services/review-package.js";
import { computeTaskScope } from "../services/task-scope.js";
import { resolveRouting } from "../services/model-routing.js";
import { persistTaskAttachments, taskHasImageAttachment } from "../services/task-attachments.js";

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
  agentKind?: AgentKind;
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
  routing_mode: z.enum(["auto", "manual"]).default("auto"),
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
  origin_codex_thread_id: z.string().optional(),
  origin_codex_thread_url: z.string().optional(),
  origin_source: z.string().optional(),
  idempotency_key: z.string().min(1).max(128).optional(),
});

export type StartTaskInput = z.infer<typeof StartTaskSchema>;

export function createStartTaskHandler(config: Config, taskStore: TaskStore, dependencies: StartTaskDependencies = {}) {
  const runTask = dependencies.runTask ?? runMimoTask;
  const runningTasks = dependencies.runningTasks ?? globalRunningTasks;
  const taskQueue = dependencies.taskQueue ?? globalTaskQueue;
  const agentId = dependencies.agentId ?? "mimo";
  const agentKind = dependencies.agentKind ?? "mimo";

  const failTask = (taskId: string, requestId: string, phase: TaskErrorDetail["phase"], code: string, error: unknown, retryable = false) => {
    const message = safeErrorMessage(error);
    const detail: TaskErrorDetail = {
      code,
      message,
      phase,
      request_id: requestId,
      occurred_at: new Date().toISOString(),
      retryable,
    };
    taskStore.updateTaskStatus(taskId, "failed", message, detail);
    process.stderr.write(`[task:${taskId}] request_id=${requestId} phase=${phase} code=${code}\n`);
    try { refreshReviewPackage(taskStore, taskId); } catch { /* task may not have runner output yet */ }
  };

  function executeRunner(taskId: string, requestId: string, taskConfig: any, worktreeState: WorktreeState | null, editablePaths: string[]): Promise<void> {
    const task = taskStore.getTask(taskId);
    if (!task || task.status === "cancelled") return Promise.resolve();
    taskStore.updateTaskQueueState(taskId, "active");

    return new Promise((resolve) => {
      let settled = false;
      let agentStarted = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        runningTasks.unregister(taskId);
        resolve();
      };
      const complete = (result: TaskResult) => {
        if (settled) return;
        try {
          if (result.session_id) taskStore.updateTaskSession(taskId, result.session_id);
          else if (result.agent_session_path) taskStore.updateTaskAgentSession(taskId, result.agent_session_path);
          taskStore.updateTaskResult(taskId, result);
          taskStore.updateTaskStatus(taskId, result.status);
          if (worktreeState) {
            try {
              const gitManager = new GitWorktreeManager(task.config.workspace_path, config.runtimeDir);
              const summary = gitManager.getDiffSummaryForState(taskId, worktreeState, editablePaths);
              worktreeState = { ...worktreeState, diff_summary: summary.diffStat, out_of_bounds_files: summary.outOfBoundsFiles, has_out_of_bounds_changes: summary.hasOutOfBoundsChanges };
              taskStore.updateTaskWorktree(taskId, worktreeState);
            } catch {
              process.stderr.write(`[task:${taskId}] request_id=${requestId} phase=running code=DIFF_SUMMARY_FAILED\n`);
            }
          }
          refreshReviewPackage(taskStore, taskId);
        } finally { finish(); }
      };
      const fail = (error: string) => {
        if (settled) return;
        try { failTask(taskId, requestId, agentStarted ? "running" : "starting_agent", agentStarted ? "AGENT_RUN_FAILED" : "AGENT_START_FAILED", error, true); }
        finally { finish(); }
      };

      try {
        const latest = taskStore.getTask(taskId) ?? task;
        const handle = runTask({
          mimoNodePath: config.mimoNodePath,
          mimoEntryPath: config.mimoEntryPath,
          task: { ...latest, config: taskConfig },
          runtimeDir: config.runtimeDir,
          timeoutMs: latest.config.runtime_timeout_seconds * 1000,
        }, complete, fail);
        if (!settled) {
          agentStarted = true;
          taskStore.updateTaskStatus(taskId, "running");
          runningTasks.register(taskId, () => { handle.cancel(); finish(); });
        }
      } catch (error) {
        fail(safeErrorMessage(error));
      }
    });
  }

  return {
    schema: StartTaskSchema,
    handler: async (input: StartTaskInput) => {
      const requestId = `req_${randomUUID()}`;
      const idempotencyHash = input.idempotency_key ? sha256(input.idempotency_key) : undefined;
      const requestFingerprint = sha256(stableStringify({ ...input, idempotency_key: undefined, agent_id: agentId }));

      if (idempotencyHash) {
        const existing = taskStore.findByIdempotencyHash(idempotencyHash);
        if (existing) {
          if (existing.request_fingerprint !== requestFingerprint) {
            return { error: "idempotency_key 已用于不同的任务请求", code: "IDEMPOTENCY_CONFLICT", request_id: existing.request_id ?? requestId };
          }
          return {
            task_id: existing.task_id,
            request_id: existing.request_id,
            status: existing.status,
            queue_state: existing.queue_state ?? "none",
            idempotent_replay: true,
          };
        }
      }

      const workspaceValidation = validateWorkspacePath(input.workspace_path, config.allowedRoots);
      if (!workspaceValidation.allowed) {
        const details = config.diagnostics ? {
          config_file: config.diagnostics.configFile,
          config_source: config.diagnostics.configSource,
          config_loaded_at: config.diagnostics.loadedAt,
          config_fingerprint: config.diagnostics.fingerprint,
          reload_required: config.diagnostics.isReloadRequired?.() ?? config.diagnostics.reloadRequired,
          normalized_workspace_path: workspaceValidation.normalizedPath,
          allowed_roots_count: config.diagnostics.allowedRootsCount,
          action_required: "add_allowed_root_then_restart",
          restart_command: config.diagnostics.restartCommand,
        } : { normalized_workspace_path: workspaceValidation.normalizedPath, allowed_roots_count: config.allowedRoots.length };
        return { error: workspaceValidation.reason, code: "WORKSPACE_NOT_ALLOWED", request_id: requestId, details };
      }
      const editableValidation = validateEditablePaths(input.editable_paths, workspaceValidation.normalizedPath ?? input.workspace_path);
      if (!editableValidation.allowed) return { error: editableValidation.reason, code: "EDITABLE_PATH_INVALID", request_id: requestId };
      const maxRoundsValidation = validateMaxRounds(input.max_rounds);
      if (!maxRoundsValidation.allowed) return { error: maxRoundsValidation.reason, code: "MAX_ROUNDS_INVALID", request_id: requestId };
      const timeoutValidation = validateTimeout(input.runtime_timeout_seconds);
      if (!timeoutValidation.allowed) return { error: timeoutValidation.reason, code: "TIMEOUT_INVALID", request_id: requestId };

      const normalizedWorkspace = workspaceValidation.normalizedPath ?? input.workspace_path;
      const scopeResult = computeTaskScope({ ...input, workspace_path: normalizedWorkspace });
      if (!scopeResult.ok) return { error: scopeResult.error, code: "SCOPE_INVALID", request_id: requestId };
      const hasImages = input.has_images || taskHasImageAttachment(input.attachments);
      const routingResult = resolveRouting(agentKind, { ...input, has_images: hasImages }, config.routingProfiles);
      if (!routingResult.ok) return { error: routingResult.error, code: "ROUTING_INVALID", request_id: requestId };

      const task = taskStore.createTask({
        objective: input.objective,
        workspace_path: normalizedWorkspace,
        editable_paths: scopeResult.effective_config.editable_paths,
        readonly_paths: scopeResult.effective_config.readonly_paths,
        acceptance_criteria: input.acceptance_criteria,
        max_rounds: input.max_rounds,
        runtime_timeout_seconds: input.runtime_timeout_seconds,
        scope: scopeResult.snapshot,
        routing: routingResult.config,
        attachments: [],
        origin_codex_thread_id: input.origin_codex_thread_id,
        origin_codex_thread_url: input.origin_codex_thread_url,
        origin_source: input.origin_source,
      }, {
        agent: agentId,
        status: "preparing_worktree",
        request_id: requestId,
        queue_state: "queued",
        idempotency_key_hash: idempotencyHash,
        request_fingerprint: requestFingerprint,
      });

      let worktreeState: WorktreeState | null = null;
      let cancelled = false;
      const taskId = task.task_id;
      const editablePaths = scopeResult.effective_config.editable_paths;
      const cleanupPreparedWorktree = () => {
        if (!worktreeState) return;
        try {
          GitWorktreeManager.fromWorktreeState(worktreeState).discardWorktree(taskId, worktreeState.branch_name);
          worktreeState = null;
          taskStore.updateTaskWorktree(taskId, null);
        } catch {
          process.stderr.write(`[task:${taskId}] request_id=${requestId} phase=preparing_worktree code=WORKTREE_CLEANUP_FAILED\n`);
        }
      };
      const startedImmediately = taskQueue.enqueue({
        taskId,
        agentId,
        workspacePath: normalizedWorkspace,
        editablePaths,
        priority: input.priority,
        enqueuedAt: Date.now(),
        requestId,
        getStatus: () => taskStore.getTask(taskId)?.status,
        execute: async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          if (cancelled || taskStore.getTask(taskId)?.status === "cancelled") return;
          taskStore.updateTaskQueueState(taskId, "active");
          runningTasks.register(taskId, () => {
            cancelled = true;
            cleanupPreparedWorktree();
            taskStore.updateTaskStatus(taskId, "cancelled");
          });
          try {
            const attachmentResult = persistTaskAttachments(config.runtimeDir, taskId, input.attachments);
            if (!attachmentResult.ok) throw new TaskPreparationError("ATTACHMENT_PERSIST_FAILED", attachmentResult.error);
            const latest = taskStore.getTask(taskId);
            if (!latest || cancelled) return;
            latest.config.attachments = attachmentResult.attachments;
            taskStore.saveTask(latest);

            let worktreePath = normalizedWorkspace;
            if (input.use_worktree) {
              const gitManager = new GitWorktreeManager(normalizedWorkspace, config.runtimeDir);
              if (!gitManager.isGitRepo()) throw new TaskPreparationError("NOT_A_GIT_REPOSITORY", "use_worktree=true 但工作区不是 Git 仓库");
              const info = gitManager.createWorktree(taskId);
              worktreePath = info.worktreePath;
              worktreeState = {
                repo_path: info.repoPath, worktrees_root: info.worktreesRoot, worktree_path: info.worktreePath,
                branch_name: info.branchName, base_commit: info.baseCommit, base_branch: info.baseBranch,
                diff_summary: null, out_of_bounds_files: [], has_out_of_bounds_changes: false,
              };
              taskStore.updateTaskWorktree(taskId, worktreeState);
            }
            if (cancelled) return;
            const refreshed = taskStore.getTask(taskId);
            if (!refreshed) return;
            const taskConfig = { ...refreshed.config, workspace_path: worktreePath };
            writeTaskBrief(taskConfig, taskId, refreshed.current_round, `${config.runtimeDir}/briefs`);
            taskStore.updateTaskStatus(taskId, "starting_agent");
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (!cancelled) await executeRunner(taskId, requestId, taskConfig, worktreeState, editablePaths);
          } catch (error) {
            const code = error instanceof TaskPreparationError ? error.code : "WORKTREE_PREPARATION_FAILED";
            cleanupPreparedWorktree();
            failTask(taskId, requestId, "preparing_worktree", code, error, code === "WORKTREE_PREPARATION_FAILED");
          } finally {
            if (taskStore.getTask(taskId)?.status !== "running") runningTasks.unregister(taskId);
          }
        },
        cancel: () => {
          cancelled = true;
          cleanupPreparedWorktree();
          taskStore.updateTaskStatus(taskId, "cancelled");
        },
      });
      taskStore.updateTaskQueueState(taskId, startedImmediately ? "active" : "queued");

      return {
        task_id: taskId,
        request_id: requestId,
        status: "preparing_worktree",
        queue_state: startedImmediately ? "active" : "queued",
        queue_position: startedImmediately ? 0 : taskQueue.size,
        idempotent_replay: false,
      };
    },
    cancelTask: (taskId: string) => taskQueue.cancel(taskId) || runningTasks.cancel(taskId),
    getQueueStatus: () => ({
      capacity: taskQueue.capacity,
      running: taskQueue.running,
      queued: taskQueue.size,
      active: taskQueue.getActiveTasks(),
      queue: taskQueue.getQueuedTasks(),
    }),
  };
}

class TaskPreparationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 1000);
}
