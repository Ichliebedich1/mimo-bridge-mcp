import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename } from "node:path";
import { platform } from "node:os";
import { execFileSync } from "node:child_process";
import type { AgentConfig, TaskResult, TaskState } from "../types.js";
import { extractReasonixTokenUsageFromFile } from "./reasonix-event-parser.js";
import { findReasonixSessionPath } from "./reasonix-session-store.js";
import { globalTokenBudget } from "./token-budget.js";
import { reasoningEffortToMaxSteps } from "./model-routing.js";

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

const MAX_AUTO_RESUME_ATTEMPTS = 2;

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

  prepareReasonixWorkspace(task.config.workspace_path);
  const startedAtMs = Date.now();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let settled = false;
  let autoResumeAttempts = 0;
  let currentChild: ChildProcessWithoutNullStreams | null = null;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const settleFinal = (exitCode: number | null, signal: NodeJS.Signals | null = null): void => {
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

  function startAttempt(attemptResumePath: string | null | undefined): ChildProcessWithoutNullStreams {
    const args = buildReasonixRunArgs(agent, briefPath, task.config.workspace_path, task, attemptResumePath);
    const attemptStdoutChunks: string[] = [];
    const attemptStderrChunks: string[] = [];
    writeReasonixEvent(
      logPath,
      attemptResumePath ? "auto_resume_start" : "start",
      attemptResumePath
        ? `Reasonix TUI auto-resume attempt ${autoResumeAttempts} started.`
        : "Reasonix TUI task started."
    );

    const child = spawn(agent.command!, args, {
      cwd: task.config.workspace_path,
      env: {
        ...process.env,
        ...(agent.home_dir ? { REASONIX_HOME: agent.home_dir } : {}),
        REASONIX_LANG: process.env.REASONIX_LANG || "zh",
      },
      windowsHide: true,
    });
    currentChild = child;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stdoutChunks.push(text);
      attemptStdoutChunks.push(text);
      appendRaw(stdoutChunks, logPath, "message", text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderrChunks.push(text);
      attemptStderrChunks.push(text);
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
      handleAttemptExit(exitCode, signal, attemptResumePath, attemptStdoutChunks.join(""), attemptStderrChunks.join(""));
    });

    return child;
  }

  function handleAttemptExit(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    attemptResumePath: string | null | undefined,
    attemptStdout: string,
    attemptStderr: string
  ): void {
    if (settled || cancelled) return;
    const sessionCandidate = findReasonixSessionPath({
      homeDir: agent.home_dir,
      workspacePath: task.config.workspace_path,
      taskId: task.task_id,
      startedAtMs,
      finishedAtMs: Date.now(),
    });
    const nextResumePath = sessionCandidate?.path ?? attemptResumePath ?? null;

    if (
      exitCode !== 0 &&
      isReasonixMaxStepsPause(attemptStdout, attemptStderr) &&
      nextResumePath &&
      existsSync(nextResumePath) &&
      autoResumeAttempts < MAX_AUTO_RESUME_ATTEMPTS
    ) {
      autoResumeAttempts += 1;
      writeReasonixEvent(
        logPath,
        "auto_resume",
        `Reasonix paused after max steps; auto-resuming saved session (${autoResumeAttempts}/${MAX_AUTO_RESUME_ATTEMPTS}).`
      );
      startAttempt(nextResumePath);
      return;
    }

    settleFinal(exitCode, signal);
  }

  timeoutId = setTimeout(() => {
    if (settled || cancelled) return;
    cancelled = true;
    if (currentChild) {
      stopChildProcessTree(currentChild);
    }
    onError(`Reasonix task timed out: ${timeoutMs}ms`);
  }, timeoutMs);

  const firstChild = startAttempt(resumeSessionPath);

  return {
    process: firstChild,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (currentChild) {
        stopChildProcessTree(currentChild);
      }
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
  task?: TaskState,
  resumeSessionPath?: string | null
): string[] {
  const args = [...(agent.command_args ?? []), "run"];
  const model = task?.config.routing?.model ?? agent.default_model;
  if (model) {
    args.push("--model", model);
  }

  const routingMaxSteps = task?.config.routing?.reasoning_effort
    ? reasoningEffortToMaxSteps(task.config.routing.reasoning_effort)
    : undefined;
  const configuredMaxSteps = agent.max_steps && Number.isInteger(agent.max_steps) && agent.max_steps > 0
    ? agent.max_steps
    : undefined;
  const maxSteps = routingMaxSteps ?? configuredMaxSteps;
  if (maxSteps) {
    args.push("--max-steps", String(maxSteps));
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

function isReasonixMaxStepsPause(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`;
  return /paused\s+after[\s\S]{0,160}(?:agent\.)?max[_-]?steps/i.test(text)
    || /agent\.max_steps/i.test(text)
    || (/max[_-]?steps/i.test(text) && /paused|pause|暂停|上限/.test(text));
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
