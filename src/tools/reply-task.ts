import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import type { TaskResult } from "../types.js";
import { validateSessionId } from "../services/path-guard.js";
import { writeReplyBrief } from "../services/prompt-builder.js";
import { runMimoTask } from "../services/mimo-runner.js";
import { globalRunningTasks } from "../services/running-tasks.js";

export const ReplyTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
  message: z.string().min(1, "回复消息不能为空"),
});

export type ReplyTaskInput = z.infer<typeof ReplyTaskSchema>;

export function createReplyTaskHandler(config: Config, taskStore: TaskStore) {
  return {
    schema: ReplyTaskSchema,
    handler: async (input: ReplyTaskInput) => {
      if (globalRunningTasks.hasAny()) {
        return { error: "已有任务在运行中，第一版只支持同时运行一个写任务" };
      }

      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      if (task.status !== "waiting" && task.status !== "review") {
        return { error: `任务状态不允许回复: ${task.status}` };
      }

      if (!task.session_id) {
        return { error: "任务没有会话 ID，无法回复" };
      }

      const sessionValidation = validateSessionId(task.session_id);
      if (!sessionValidation.allowed) {
        return { error: sessionValidation.reason };
      }

      if (task.current_round > task.config.max_rounds) {
        return { error: `已达到最大沟通轮数: ${task.config.max_rounds}` };
      }

      writeReplyBrief(input.message, task.task_id, task.current_round, `${config.runtimeDir}/briefs`);

      taskStore.updateTaskStatus(task.task_id, "running");

      const handle = runMimoTask(
        {
          mimoNodePath: config.mimoNodePath,
          mimoEntryPath: config.mimoEntryPath,
          task,
          runtimeDir: config.runtimeDir,
          timeoutMs: task.config.runtime_timeout_seconds * 1000,
        },
        (result: TaskResult) => {
          if (result.session_id) {
            taskStore.updateTaskSession(task.task_id, result.session_id);
          }
          taskStore.updateTaskResult(task.task_id, result);
          taskStore.updateTaskStatus(task.task_id, result.status);
          globalRunningTasks.unregister(task.task_id);
        },
        (error: string) => {
          taskStore.updateTaskStatus(task.task_id, "failed", error);
          globalRunningTasks.unregister(task.task_id);
        }
      );

      globalRunningTasks.register(task.task_id, handle.cancel);

      return {
        task_id: task.task_id,
        status: "running",
      };
    },
    cancelTask: (taskId: string) => {
      return globalRunningTasks.cancel(taskId);
    },
  };
}
