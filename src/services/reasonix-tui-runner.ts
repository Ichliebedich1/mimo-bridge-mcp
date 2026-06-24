import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename } from "node:path";
import { platform } from "node:os";
import { execFileSync } from "node:child_process";
import type { AgentConfig, TaskResult, TaskState } from "../types.js";
import { extractReasonixTokenUsageFromFile } from "./reasonix-event-parser.js";
import { findReasonixSessionPath } from "./reasonix-session-store.js";
import { globalTokenBudget } from "./token-budget.js";

export interface ReasonixRunnerOptions {
  agent: AgentConfig;
  task: TaskState;
  runtimeDir: string;
  timeoutMs: number;
  resumeSessionPath?: string | null;
}

export interface ReasonixRunnerHandle {
  process: ChildProcessWithoutNullStreams;
  cancel: () => void;
}

export function runReasonixTuiTask(
  options: ReasonixRunnerOptions,
  onResult: (result: TaskResult) => void,
  onError: (error: string) => void
): ReasonixRunnerHandle {
  const { agent, task, runtimeDir, timeoutMs, resumeSessionPath } = options;
  if (!agent.command) {
    throw new Error("Reasonix command is not configured.");
  }

  const round = task.current_round;
  const logPath = `${runtimeDir}/logs/${task.task_id}-round-${round}.jsonl`;
  const stderrLogPath = `${runtimeDir}/logs/${task.task_id}-round-${round}.stderr.log`;
  const briefPath = `${runtimeDir}/briefs/${task.task_id}-round-${round}.md`;
  const args = buildReasonixRunArgs(agent, briefPath, task.config.workspace_path, resumeSessionPath);

  prepareReasonixWorkspace(task.config.workspace_path);
  writeReasonixEvent(logPath, "start", "Reasonix TUI task started.");
  const startedAtMs = Date.now();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let settled = false;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const child = spawn(agent.command, args, {
    cwd: task.config.workspace_path,
    env: {
      ...process.env,
      ...(agent.home_dir ? { REASONIX_HOME: agent.home_dir } : {}),
      REASONIX_LANG: process.env.REASONIX_LANG || "zh",
    },
    windowsHide: true,
  });

  const settle = (exitCode: number | null, signal: NodeJS.Signals | null = null): void => {
    if (settled || cancelled) return;
    settled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    const stdout = stdoutChunks.join("");
    const stderr = stderrChunks.join("");
    const summary = summarizeReasonixOutput(stdout, stderr, exitCode, signal);
    const sessionCandidate = findReasonixSessionPath({
      homeDir: agent.home_dir,
      workspacePath: task.config.workspace_path,
      taskId: task.task_id,
      startedAtMs,
      finishedAtMs: Date.now(),
    });
    const status = exitCode === 0 ? "review" : "failed";
    recordReasonixTokenUsage(task, sessionCandidate?.path ?? null);
    const result: TaskResult = {
      task_id: task.task_id,
      agent: "reasonix-tui",
      session_id: null,
      agent_session_path: sessionCandidate?.path ?? null,
      status,
      summary,
      modified_files: [],
      test_results: "",
      questions: [],
      issues: exitCode === 0 ? [] : [`Reasonix exit code: ${exitCode ?? "null"}`],
      raw_log_path: logPath,
      stderr_log_path: stderrLogPath,
      error: exitCode === 0 ? null : `Reasonix exit code: ${exitCode ?? "null"}`,
      exit_code: exitCode,
    };
    if (sessionCandidate) {
      writeReasonixEvent(logPath, "session", `Reasonix session mapped: ${basename(sessionCandidate.path)}`);
    }
    writeReasonixEvent(logPath, status, summary);
    onResult(result);
  };

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    stdoutChunks.push(text);
    appendRaw(stdoutChunks, logPath, "message", text);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    stderrChunks.push(text);
    try {
      appendFileSync(stderrLogPath, text, "utf-8");
    } catch {
      // Logs are diagnostic only; task lifecycle should not depend on log writes.
    }
    appendRaw(stderrChunks, logPath, "event", text, "stderr");
  });

  child.on("error", (error) => {
    if (settled || cancelled) return;
    settled = true;
    if (timeoutId) clearTimeout(timeoutId);
    onError(`Reasonix failed to start: ${error.message}`);
  });

  child.on("exit", (exitCode, signal) => {
    settle(exitCode, signal);
  });

  timeoutId = setTimeout(() => {
    if (settled || cancelled) return;
    cancelled = true;
    stopChildProcessTree(child);
    onError(`Reasonix task timed out: ${timeoutMs}ms`);
  }, timeoutMs);

  return {
    process: child,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      stopChildProcessTree(child);
    },
  };
}

function recordReasonixTokenUsage(task: TaskState, sessionPath: string | null): void {
  const usage = extractReasonixTokenUsageFromFile(sessionPath);
  if (usage.events_count === 0 || usage.total_tokens <= 0) {
    return;
  }

  globalTokenBudget.recordUsage(
    usage.input_tokens,
    usage.output_tokens,
    `${task.task_id} round ${task.current_round} reasonix-tui`,
    {
      totalTokens: usage.total_tokens,
      estimatedCost: usage.estimated_cost ?? undefined,
    },
  );
}

function buildReasonixRunArgs(
  agent: AgentConfig,
  briefPath: string,
  workspacePath: string,
  resumeSessionPath?: string | null
): string[] {
  const args = [...(agent.command_args ?? []), "run"];
  if (agent.default_model) {
    args.push("--model", agent.default_model);
  }
  if (agent.max_steps && Number.isInteger(agent.max_steps) && agent.max_steps > 0) {
    args.push("--max-steps", String(agent.max_steps));
  }
  if (resumeSessionPath) {
    args.push("--resume", resumeSessionPath);
  }
  args.push([
    "你正在 MiMo Bridge 管控的任务 Worktree 中运行。",
    `当前工作目录就是目标项目目录: ${workspacePath}`,
    "所有任务说明里的相对路径都必须按当前工作目录解析。",
    "不要把任务说明文件所在的 runtime/briefs 目录当成项目目录，也不要修改 runtime 目录。",
    `请读取任务说明文件并完成任务: ${briefPath}`,
  ].join("\n"));
  return args;
}

function prepareReasonixWorkspace(workspacePath: string): void {
  addGitExclude(workspacePath, [
    "cad_mcp.log",
    "solidworks_mcp.log",
    "reasonix_mcp.log",
  ]);
}

function addGitExclude(workspacePath: string, patterns: string[]): void {
  try {
    const excludePath = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: workspacePath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
    const missing = patterns.filter((pattern) => !existing.split(/\r?\n/).includes(pattern));
    if (missing.length === 0) {
      return;
    }
    appendFileSync(excludePath, `${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}# MiMo Bridge Reasonix side-effect logs\n${missing.join("\n")}\n`, "utf-8");
  } catch {
    // Non-git workspaces still run; Worktree review is simply less precise there.
  }
}

function appendRaw(chunks: string[], logPath: string, eventType: string, text: string, status?: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  writeReasonixEvent(logPath, eventType, trimmed, status);
  if (chunks.join("").length > 128_000) {
    chunks.splice(0, chunks.length - 8);
  }
}

function writeReasonixEvent(logPath: string, type: string, summary: string, status?: string): void {
  const event = {
    type,
    timestamp: Date.now(),
    agent: "reasonix-tui",
    summary: summary.slice(0, 4000),
    ...(status ? { status } : {}),
  };
  try {
    appendFileSync(logPath, JSON.stringify(event) + "\n", "utf-8");
  } catch {
    // Ignore log write failures; the runner will still report task result.
  }
}

function summarizeReasonixOutput(stdout: string, stderr: string, exitCode: number | null, signal: NodeJS.Signals | null): string {
  const visible = stdout.trim() || stderr.trim();
  const header = exitCode === 0 ? "Reasonix TUI 已完成任务。" : `Reasonix TUI 任务失败，exit_code=${exitCode ?? "null"}${signal ? `, signal=${signal}` : ""}。`;
  if (!visible) return header;
  const tail = visible.slice(-3000);
  return `${header}\n\n${tail}`;
}

function stopChildProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (platform() === "win32" && child.pid) {
    try {
      execFileSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      // Fall back to child.kill.
    }
  }
  try {
    child.kill();
  } catch {
    // Process may already be gone.
  }
}
