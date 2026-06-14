import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import type { TaskResult } from "../types.js";
import { validateWorkspacePath, validateEditablePaths, validateMaxRounds, validateTimeout } from "../services/path-guard.js";
import { writeTaskBrief } from "../services/prompt-builder.js";
import { runMimoTask } from "../services/mimo-runner.js";

export const StartTaskSchema = z.object({
  objective: z.string().min(1, "任务目标不能为空"),
  workspace_path: z.string().min(1, "工作区路径不能为空"),
  editable_paths: z.array(z.string()).default([]),
  readonly_paths: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  max_rounds: z.number().int().min(1).max(10).default(5),
  runtime_timeout_seconds: z.number().int().min(60).max(3600).default(900),
});

export type StartTaskInput = z.infer<typeof StartTaskSchema>;

export function createStartTaskHandler(config: Config, taskStore: TaskStore) {
  const runningTasks = new Map<string, { cancel: () => void }>();

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

      const task = taskStore.createTask({
        objective: input.objective,
        workspace_path: input.workspace_path,
        editable_paths: input.editable_paths,
        readonly_paths: input.readonly_paths,
        acceptance_criteria: input.acceptance_criteria,
        max_rounds: input.max_rounds,
        runtime_timeout_seconds: input.runtime_timeout_seconds,
      });

      writeTaskBrief(task.config, task.task_id, `${config.runtimeDir}/briefs`);

      taskStore.updateTaskStatus(task.task_id, "running");

      const handle = runMimoTask(
        {
          mimoNodePath: config.mimoNodePath,
          mimoEntryPath: config.mimoEntryPath,
          task,
          runtimeDir: config.runtimeDir,
          timeoutMs: input.runtime_timeout_seconds * 1000,
        },
        (result: TaskResult) => {
          if (result.session_id) {
            taskStore.updateTaskSession(task.task_id, result.session_id);
          }
          taskStore.updateTaskResult(task.task_id, result);
          taskStore.updateTaskStatus(task.task_id, result.status);
          runningTasks.delete(task.task_id);
        },
        (error: string) => {
          taskStore.updateTaskStatus(task.task_id, "failed", error);
          runningTasks.delete(task.task_id);
        }
      );

      runningTasks.set(task.task_id, { cancel: handle.cancel });

      return {
        task_id: task.task_id,
        status: "running",
      };
    },
    cancelTask: (taskId: string) => {
      const handle = runningTasks.get(taskId);
      if (handle) {
        handle.cancel();
        runningTasks.delete(taskId);
        return true;
      }
      return false;
    },
  };
}
