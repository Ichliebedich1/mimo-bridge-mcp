import { writeFileSync } from "node:fs";
import type { TaskConfig } from "../types.js";

export function buildTaskBrief(config: TaskConfig): string {
  const lines: string[] = [];

  lines.push("# 任务说明");
  lines.push("");
  lines.push("## 任务目标");
  lines.push("");
  lines.push(config.objective);
  lines.push("");

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

export function buildReplyBrief(message: string): string {
  return `# 任务说明\n\n## 回复内容\n\n${message}\n`;
}

export function writeReplyBrief(message: string, taskId: string, round: number, briefsDir: string): string {
  const briefContent = buildReplyBrief(message);
  const briefPath = `${briefsDir}/${taskId}-round-${round}.md`;

  writeFileSync(briefPath, briefContent, "utf-8");
  return briefPath;
}
