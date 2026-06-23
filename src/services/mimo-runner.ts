import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import * as pty from "node-pty";
import type { TaskState, TaskResult } from "../types.js";
import { createEventParser, extractTokenUsage, isTerminalMimoEvent } from "./event-parser.js";
import { globalTokenBudget } from "./token-budget.js";

export interface RunnerOptions {
  mimoNodePath: string;
  mimoEntryPath: string;
  task: TaskState;
  runtimeDir: string;
  timeoutMs: number;
}

export interface RunnerHandle {
  process: pty.IPty;
  cancel: () => void;
}

export function runMimoTask(
  options: RunnerOptions,
  onResult: (result: TaskResult) => void,
  onError: (error: string) => void
): RunnerHandle {
  const { mimoNodePath, mimoEntryPath, task, runtimeDir, timeoutMs } = options;
  const parser = createEventParser();

  const round = task.current_round;
  const logPath = `${runtimeDir}/logs/${task.task_id}-round-${round}.jsonl`;
  const stderrLogPath = `${runtimeDir}/logs/${task.task_id}-round-${round}.stderr.log`;

  const args = buildMimoArgs(task, runtimeDir);

  process.stderr.write(`[mimo-runner] Spawning with PTY: ${mimoNodePath} ${[mimoEntryPath, ...args].join(" ")}\n`);

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const ptyProcess = pty.spawn(mimoNodePath, [mimoEntryPath, ...args], {
    name: "xterm-256color",
    cols: 10000,
    rows: 30,
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  });

  process.stderr.write(`[mimo-runner] PTY PID: ${ptyProcess.pid}\n`);

  let settled = false;

  const complete = (exitCode: number): void => {
    if (settled || cancelled) return;
    settled = true;

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    const parsed = parser.flush();
    const summary = parser.getSummary(parsed);
    const questions = parser.extractQuestions(parsed);
    const issues = parser.extractIssues(parsed);
    recordMimoTokenUsage(task, parsed);

    if (!parsed.sessionId) {
      onError("MiMo 未返回 sessionID，任务失败");
      return;
    }

    const result: TaskResult = {
      task_id: task.task_id,
      agent: "mimo",
      session_id: parsed.sessionId,
      status: exitCode === 0 ? "review" : "failed",
      summary,
      modified_files: [],
      test_results: "",
      questions,
      issues,
      raw_log_path: logPath,
      stderr_log_path: stderrLogPath,
      error: null,
      exit_code: exitCode,
    };

    if (exitCode !== 0) {
      result.error = `MiMo 退出码: ${exitCode}`;
      result.issues.push(`MiMo 退出码: ${exitCode}`);
    }

    onResult(result);
  };

  const handle: RunnerHandle = {
    process: ptyProcess,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      stopPtyProcessTree(ptyProcess);
    },
  };

  ptyProcess.onData((data: string) => {
    try {
      appendFileSync(logPath, data, "utf-8");
    } catch {
      // 日志写入失败不阻塞主流程
    }

    const parsed = parser.parse(data);
    const finished = parsed.events.some(isTerminalMimoEvent);
    if (finished && !settled && !cancelled) {
      complete(0);
      stopPtyProcessTree(ptyProcess);
    }
  });

  timeoutId = setTimeout(() => {
    if (!cancelled && !settled) {
      settled = true;
      cancelled = true;
      stopPtyProcessTree(ptyProcess);
      onError(`任务超时（${timeoutMs}ms）`);
    }
  }, timeoutMs);

  ptyProcess.onExit(({ exitCode }) => {
    complete(exitCode);
  });

  return handle;
}

function recordMimoTokenUsage(task: TaskState, parsed: ReturnType<ReturnType<typeof createEventParser>["flush"]>): void {
  const usage = extractTokenUsage(parsed);
  if (usage.events_count === 0 || usage.total_tokens <= 0) {
    return;
  }

  globalTokenBudget.recordUsage(
    usage.input_tokens,
    usage.output_tokens,
    `${task.task_id} round ${task.current_round}`,
    {
      totalTokens: usage.total_tokens,
      estimatedCost: usage.estimated_cost ?? undefined,
    }
  );
}

function buildMimoArgs(task: TaskState, runtimeDir: string): string[] {
  const args: string[] = [
    "run",
    "--pure",
    "--dangerously-skip-permissions",
  ];

  const briefPath = `${runtimeDir}/briefs/${task.task_id}-round-${task.current_round}.md`;

  if (task.session_id && task.current_round > 1) {
    args.push("--session", task.session_id);
  }

  args.push("--dir", task.config.workspace_path);
  args.push("--format", "json");
  args.push("请读取附件中的任务说明并按要求执行。");
  args.push("--file", briefPath);

  return args;
}

function stopPtyProcessTree(ptyProcess: pty.IPty): void {
  if (platform() === "win32" && ptyProcess.pid) {
    try {
      execFileSync("taskkill", ["/T", "/F", "/PID", String(ptyProcess.pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      // Fall back to node-pty's own termination path.
    }
  }

  try {
    ptyProcess.kill();
  } catch {
    // The process may already have exited.
  }
}
