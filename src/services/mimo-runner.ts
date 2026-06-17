import { appendFileSync } from "node:fs";
import * as pty from "node-pty";
import type { TaskState, TaskResult } from "../types.js";
import { createEventParser } from "./event-parser.js";

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
    cols: 80,
    rows: 30,
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  });

  process.stderr.write(`[mimo-runner] PTY PID: ${ptyProcess.pid}\n`);

  const handle: RunnerHandle = {
    process: ptyProcess,
    cancel: () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      ptyProcess.kill();
    },
  };

  let stdoutData = "";

  let checkInterval: ReturnType<typeof setInterval> | null = null;
  let lastDataTime = Date.now();
  let noDataCount = 0;

  checkInterval = setInterval(() => {
    const now = Date.now();
    if (now - lastDataTime > 3000) {
      noDataCount++;
      if (noDataCount >= 2) {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        if (cancelled) return;
        cancelled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        const parsed = parser.flush();
        const summary = parser.getSummary(parsed);
        const questions = parser.extractQuestions(parsed);
        const issues = parser.extractIssues(parsed);
        if (!parsed.sessionId) {
          onError("MiMo 未返回 sessionID，任务失败");
          return;
        }
        const result: TaskResult = {
          task_id: task.task_id,
          agent: "mimo",
          session_id: parsed.sessionId,
          status: "review",
          summary,
          modified_files: [],
          test_results: "",
          questions,
          issues,
          raw_log_path: logPath,
          stderr_log_path: stderrLogPath,
          error: null,
        };
        onResult(result);
      }
    }
  }, 1000);

  ptyProcess.onData((data: string) => {
    lastDataTime = Date.now();
    noDataCount = 0;
    stdoutData += data;

    try {
      appendFileSync(logPath, data, "utf-8");
    } catch {
      // 日志写入失败不阻塞主流程
    }

    parser.parse(data);
  });

  timeoutId = setTimeout(() => {
    if (!cancelled) {
      cancelled = true;
      ptyProcess.kill();
      onError(`任务超时（${timeoutMs}ms）`);
    }
  }, timeoutMs);

  ptyProcess.onExit(({ exitCode }) => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    if (cancelled) return;

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    const parsed = parser.flush();
    const summary = parser.getSummary(parsed);
    const questions = parser.extractQuestions(parsed);
    const issues = parser.extractIssues(parsed);

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
    };

    if (exitCode !== 0) {
      result.status = "failed";
      result.error = `MiMo 退出码: ${exitCode}`;
      result.issues.push(`MiMo 退出码: ${exitCode}`);
    }

    onResult(result);
  });

  return handle;
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
