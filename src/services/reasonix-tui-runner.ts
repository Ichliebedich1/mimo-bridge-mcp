import { appendFileSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { platform } from "node:os";
import { execFileSync } from "node:child_process";
import type { AgentConfig, TaskResult, TaskState } from "../types.js";

export interface ReasonixRunnerOptions {
  agent: AgentConfig;
  task: TaskState;
  runtimeDir: string;
  timeoutMs: number;
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
  const { agent, task, runtimeDir, timeoutMs } = options;
  if (!agent.command) {
    throw new Error("Reasonix command is not configured.");
  }

  const round = task.current_round;
  const logPath = `${runtimeDir}/logs/${task.task_id}-round-${round}.jsonl`;
  const stderrLogPath = `${runtimeDir}/logs/${task.task_id}-round-${round}.stderr.log`;
  const briefPath = `${runtimeDir}/briefs/${task.task_id}-round-${round}.md`;
  const args = buildReasonixRunArgs(agent, briefPath);

  writeReasonixEvent(logPath, "start", "Reasonix TUI task started.");

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
    const status = exitCode === 0 ? "review" : "failed";
    const result: TaskResult = {
      task_id: task.task_id,
      agent: "reasonix-tui",
      session_id: null,
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

function buildReasonixRunArgs(agent: AgentConfig, briefPath: string): string[] {
  const args = [...(agent.command_args ?? []), "run"];
  if (agent.default_model) {
    args.push("--model", agent.default_model);
  }
  if (agent.max_steps && Number.isInteger(agent.max_steps) && agent.max_steps > 0) {
    args.push("--max-steps", String(agent.max_steps));
  }
  args.push(`请读取任务说明文件并完成任务: ${briefPath}`);
  return args;
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
