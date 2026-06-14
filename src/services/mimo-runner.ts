import { spawn, type ChildProcess, execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { platform } from "node:os";
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
  process: ChildProcess;
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

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const proc = spawn(mimoNodePath, [mimoEntryPath, ...args], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
  });

  const handle: RunnerHandle = {
    process: proc,
    cancel: () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      killProcessTree(proc);
    },
  };

  let stdoutData = "";
  let stderrData = "";

  proc.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    stdoutData += chunk;

    try {
      appendFileSync(logPath, chunk, "utf-8");
    } catch {
      // 日志写入失败不阻塞主流程
    }

    parser.parse(chunk);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    stderrData += chunk;

    try {
      appendFileSync(stderrLogPath, chunk, "utf-8");
    } catch {
      // 日志写入失败不阻塞主流程
    }
  });

  timeoutId = setTimeout(() => {
    if (!cancelled) {
      cancelled = true;
      killProcessTree(proc);
      onError(`任务超时（${timeoutMs}ms）`);
    }
  }, timeoutMs);

  proc.on("close", (code) => {
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
      status: code === 0 ? "review" : "failed",
      summary,
      modified_files: [],
      test_results: "",
      questions,
      issues,
      raw_log_path: logPath,
    };

    if (code !== 0) {
      result.status = "failed";
      result.issues.push(`MiMo 退出码: ${code}`);
    }

    onResult(result);
  });

  proc.on("error", (err) => {
    if (cancelled) return;

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    onError(`启动 MiMo 失败: ${err.message}`);
  });

  return handle;
}

function buildMimoArgs(task: TaskState, runtimeDir: string): string[] {
  const args: string[] = ["run"];

  const briefPath = `${runtimeDir}/briefs/${task.task_id}-round-${task.current_round}.md`;

  if (task.session_id && task.current_round > 1) {
    args.push("--session", task.session_id);
  }

  args.push("--file", briefPath);
  args.push("--dir", task.config.workspace_path);
  args.push("--format", "json");
  args.push("请读取附件中的任务说明并按要求执行。");

  return args;
}

function killProcessTree(proc: ChildProcess): void {
  const isWindows = platform() === "win32";

  if (isWindows && proc.pid) {
    try {
      execSync(`taskkill /T /F /PID ${proc.pid}`, { stdio: "ignore" });
      return;
    } catch {
      // taskkill 失败，尝试其他方式
    }
  }

  try {
    if (proc.pid) {
      process.kill(-proc.pid, "SIGTERM");
    }
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {
      // 进程可能已经退出
    }
  }

  setTimeout(() => {
    try {
      if (proc.exitCode === null) {
        if (isWindows && proc.pid) {
          try {
            execSync(`taskkill /T /F /PID ${proc.pid}`, { stdio: "ignore" });
          } catch {
            proc.kill("SIGKILL");
          }
        } else {
          proc.kill("SIGKILL");
        }
      }
    } catch {
      // 忽略
    }
  }, 5000);
}
