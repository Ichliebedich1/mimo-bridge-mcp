import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { AgentConfig, TaskState } from "../types.js";
import { validateSessionId } from "./path-guard.js";

const REPLYABLE_STATUSES = new Set(["waiting", "review", "failed"]);

export interface TaskReplyCapability {
  can_reply: boolean;
  reply_blockers: string[];
  reply_label: string;
}

export function computeTaskReplyCapability(task: TaskState, agents: AgentConfig[] = []): TaskReplyCapability {
  const blockers: string[] = [];
  if (!REPLYABLE_STATUSES.has(task.status)) {
    blockers.push(`当前状态不允许回复: ${task.status}`);
  }
  if (task.current_round > task.config.max_rounds) {
    blockers.push(`已达到最大沟通轮数 ${task.config.max_rounds}`);
  }

  if (task.agent === "mimo") {
    if (!task.session_id) {
      blockers.push("任务没有 MiMo 会话 ID，无法继续回复");
    } else {
      const validation = validateSessionId(task.session_id);
      if (!validation.allowed) {
        blockers.push(validation.reason ?? "MiMo 会话 ID 不安全，无法继续回复");
      }
    }
  } else if (task.agent === "reasonix-tui") {
    const agent = agents.find((candidate) => candidate.id === task.agent);
    if (!agent) {
      blockers.push(`找不到 Agent 配置: ${task.agent}`);
    } else if (agent.enabled === false) {
      blockers.push(`Agent 已禁用: ${task.agent}`);
    } else if (agent.kind !== "reasonix-tui") {
      blockers.push(`Agent 暂不支持回复: ${task.agent}`);
    } else if (!agent.command) {
      blockers.push("Reasonix 命令未配置");
    } else if (!task.agent_session_path) {
      blockers.push("任务没有 Reasonix 会话文件，无法继续回复");
    } else if (!agent.home_dir) {
      blockers.push("Reasonix home_dir 未配置，无法校验会话文件");
    } else {
      const sessionPath = resolve(task.agent_session_path);
      const homeDir = resolve(agent.home_dir);
      const rel = relative(homeDir, sessionPath);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        blockers.push("Reasonix 会话文件不在配置的 REASONIX_HOME 内");
      } else if (!existsSync(sessionPath)) {
        blockers.push("Reasonix 会话文件已不存在，无法继续回复");
      }
    }
  } else {
    blockers.push(`Agent 暂不支持回复: ${task.agent}`);
  }

  const canReply = blockers.length === 0;
  return {
    can_reply: canReply,
    reply_blockers: blockers,
    reply_label: canReply ? "可继续回复" : "暂不可回复",
  };
}
