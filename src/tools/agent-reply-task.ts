import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import type { AgentConfig, TaskState } from "../types.js";
import type { TaskStore } from "../services/task-store.js";
import { runReasonixTuiTask } from "../services/reasonix-tui-runner.js";
import { createReplyTaskHandler, ReplyTaskSchema, type ReplyTaskDependencies, type ReplyTaskInput } from "./reply-task.js";

export const AgentReplyTaskSchema = ReplyTaskSchema.extend({
  agent_id: z.string().min(1).optional(),
});

export type AgentReplyTaskInput = ReplyTaskInput & { agent_id?: string };

export function createAgentReplyTaskHandler(
  config: Config,
  agents: AgentConfig[],
  taskStore: TaskStore,
  dependencies: ReplyTaskDependencies = {}
) {
  return {
    schema: AgentReplyTaskSchema,
    handler: async (input: AgentReplyTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      const agentId = input.agent_id || task.agent || "mimo";
      if (task.agent !== agentId) {
        return { error: `Task ${input.task_id} belongs to agent ${task.agent}, not ${agentId}` };
      }

      if (agentId === "mimo") {
        const handler = createReplyTaskHandler(config, taskStore, {
          ...dependencies,
          agentId: "mimo",
        });
        return handler.handler(input);
      }

      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) {
        return { error: `Unknown agent_id: ${agentId}` };
      }
      if (agent.enabled === false) {
        return { error: `Agent is disabled: ${agentId}` };
      }
      if (agent.kind !== "reasonix-tui") {
        return { error: `Agent does not support reply yet: ${agentId}` };
      }
      if (!agent.command) {
        return { error: "Reasonix command is not configured." };
      }

      const handler = createReplyTaskHandler(config, taskStore, {
        ...dependencies,
        agentId,
        validateReplyTarget: (targetTask) => validateReasonixReplyTarget(targetTask, agent),
        runTask: (options, onResult, onError) => runReasonixTuiTask(
          {
            agent,
            task: options.task,
            runtimeDir: options.runtimeDir,
            timeoutMs: options.timeoutMs,
            resumeSessionPath: options.task.agent_session_path,
          },
          onResult,
          onError
        ),
      });
      return handler.handler(input);
    },
  };
}

function validateReasonixReplyTarget(task: TaskState, agent: AgentConfig): string | null {
  if (!task.agent_session_path) {
    return "Reasonix task has no recorded session path; cannot resume.";
  }
  if (!agent.home_dir) {
    return "Reasonix home_dir is not configured; cannot validate session path.";
  }

  const sessionPath = resolve(task.agent_session_path);
  const homeDir = resolve(agent.home_dir);
  const rel = relative(homeDir, sessionPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return "Reasonix session path is outside configured REASONIX_HOME; cannot resume.";
  }
  if (!existsSync(sessionPath)) {
    return "Reasonix session file no longer exists; cannot resume.";
  }
  return null;
}
