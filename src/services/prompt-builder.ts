import { writeFileSync } from "node:fs";
import type { RoutingConfig, TaskConfig } from "../types.js";

export function buildTaskBrief(config: TaskConfig): string {
  const lines: string[] = [];

  lines.push("# 任务说明");
  lines.push("");
  lines.push("## 任务目标");
  lines.push("");
  lines.push(config.objective);
  lines.push("");

  if (config.scope) {
    const scope = config.scope;
    lines.push("## 任务安全边界");
    lines.push("");
    lines.push(`- **Scope Mode**: ${scope.mode}`);
    lines.push(`- **Include Tests**: ${scope.include_tests}`);
    if (scope.mode === "repo-wide") {
      lines.push(`- **Repo-wide Confirmed**: ${scope.repo_wide_confirmed ? "是" : "否"}`);
    }
    lines.push("");
    lines.push(`有效可编辑路径: ${scope.effective_editable_paths.length > 0 ? scope.effective_editable_paths.join(", ") : "(无)"}`);
    lines.push(`有效只读路径: ${scope.effective_readonly_paths.length > 0 ? scope.effective_readonly_paths.join(", ") : "(无)"}`);
    lines.push("");
    if (scope.mode === "suggested") {
      lines.push("当前为 suggested 模式。如需扩大修改范围，请在总结中申请，不要直接越界修改。");
      lines.push("");
    }
    lines.push("越界修改会被系统拒绝，risk_flags 会标记 OUT_OF_SCOPE_CHANGES，review_recommendation 会变为 reject。");
    lines.push("");
  }

  if (config.routing) {
    lines.push("## 模型路由");
    lines.push("");
    lines.push(`- **Routing Mode**: ${config.routing.routing_mode}`);
    lines.push(`- **Task Scenario**: ${config.routing.task_scenario}`);
    lines.push(`- **Agent**: ${config.routing.agent_id}`);
    lines.push(`- **Model**: ${config.routing.model}`);
    lines.push(`- **Thinking Effort**: ${config.routing.reasoning_effort}`);
    lines.push(`- **Reason**: ${config.routing.routing_reason}`);
    lines.push("");
    lines.push("请按上述模型路由执行。若你认为任务复杂度或模型选择不合适，请在总结中说明，不要自行绕过 Bridge 配置。");
    lines.push("");
  }

  if (config.editable_paths.length > 0) {
    lines.push("## 允许修改的文件范围");
    lines.push("");
    for (const p of config.editable_paths) {
      lines.push(`- \`${p}\``);
    }
    lines.push("");
    lines.push("请只修改上述范围内的文件。超出范围的修改将被拒绝。");
    lines.push("");
  }

  if (config.readonly_paths.length > 0) {
    lines.push("## 只读参考文件");
    lines.push("");
    for (const p of config.readonly_paths) {
      lines.push(`- \`${p}\``);
    }
    lines.push("");
    lines.push("这些文件仅供参考，请勿修改。");
    lines.push("");
  }

  if (config.attachments && config.attachments.length > 0) {
    lines.push("## 附件");
    lines.push("");
    lines.push("本任务包含由 MiMo Bridge 保存到运行目录的附件。请按需读取这些文件；不要假设浏览器原始本地路径存在。");
    lines.push("");
    for (const attachment of config.attachments) {
      lines.push(`- \`${attachment.path}\` (${attachment.name}, ${attachment.mime_type}, ${attachment.size_bytes} bytes, ${attachment.kind})`);
    }
    lines.push("");
    lines.push("如果附件是图片，请结合任务目标进行多模态分析；如果当前 Agent 无法读取图片，请在总结里明确说明。");
    lines.push("");
  }

  if (config.acceptance_criteria.length > 0) {
    lines.push("## 验收条件");
    lines.push("");
    for (let i = 0; i < config.acceptance_criteria.length; i++) {
      lines.push(`${i + 1}. ${config.acceptance_criteria[i]}`);
    }
    lines.push("");
  }

  lines.push("## 完成后请报告");
  lines.push("");
  lines.push("1. 修改了哪些文件");
  lines.push("2. 测试运行结果");
  lines.push("3. 遗留问题或需要确认的事项");
  lines.push("");
  lines.push("## 语言要求");
  lines.push("");
  lines.push("完成后的摘要、测试结果、遗留问题必须使用中文书写。文件名、命令、代码标识保持原文。");
  lines.push("");

  return lines.join("\n");
}

export function writeTaskBrief(config: TaskConfig, taskId: string, round: number, briefsDir: string): string {
  const briefContent = buildTaskBrief(config);
  const briefPath = `${briefsDir}/${taskId}-round-${round}.md`;

  writeFileSync(briefPath, briefContent, "utf-8");
  return briefPath;
}

export function buildReplyBrief(message: string, routing?: RoutingConfig): string {
  const lines = [
    "# 任务说明",
    "",
    "## 回复内容",
    "",
    message,
    "",
  ];
  if (routing) {
    lines.push(
      "## 模型路由（本轮回复）",
      "",
      `- **Routing Mode**: ${routing.routing_mode}`,
      `- **Task Scenario**: ${routing.task_scenario}`,
      `- **Agent**: ${routing.agent_id}`,
      `- **Model**: ${routing.model}`,
      `- **Thinking Effort**: ${routing.reasoning_effort}`,
      `- **Reason**: ${routing.routing_reason}`,
      "",
      "请按上述模型路由继续处理本轮回复。若你认为模型选择不合适，请在总结中说明。",
      "",
    );
  }
  return lines.join("\n");
}

export function writeReplyBrief(message: string, taskId: string, round: number, briefsDir: string, routing?: RoutingConfig): string {
  const briefContent = buildReplyBrief(message, routing);
  const briefPath = `${briefsDir}/${taskId}-round-${round}.md`;

  writeFileSync(briefPath, briefContent, "utf-8");
  return briefPath;
}
