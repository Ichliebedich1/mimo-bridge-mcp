import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { TaskStore } from "../../../src/services/task-store.js";
import type { AgentConfig, TaskState } from "../../../src/types.js";
import type { DaemonConfig } from "./daemon-config.js";

export type TaskOpenAction = "task_folder" | "session_folder" | "reasonix_gui";

export interface OpenTaskTargetInput {
  task_id: string;
  action: TaskOpenAction;
}

export interface OpenTaskTargetResult {
  task_id: string;
  action: TaskOpenAction;
  opened: boolean;
  target_kind: "worktree" | "workspace" | "reasonix_session_folder" | "reasonix_gui";
  target_name: string;
  message: string;
}

export interface OpenPathResult {
  ok: boolean;
  error?: string;
}

export interface OpenTaskTargetDependencies {
  openPath?: (path: string) => Promise<OpenPathResult> | OpenPathResult;
  openExecutable?: (command: string, args: string[], options: OpenExecutableOptions) => Promise<OpenPathResult> | OpenPathResult;
}

export interface OpenExecutableOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface ResolvedTarget {
  kind: OpenTaskTargetResult["target_kind"];
  path: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function createOpenTaskTargetHandler(
  config: DaemonConfig,
  taskStore: TaskStore,
  dependencies: OpenTaskTargetDependencies = {},
): {
  handler: (input: OpenTaskTargetInput) => Promise<OpenTaskTargetResult | { error: string }>;
} {
  const openPath = dependencies.openPath ?? defaultOpenPath;
  const openExecutable = dependencies.openExecutable ?? defaultOpenExecutable;

  return {
    handler: async (input) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `Task not found: ${input.task_id}` };
      }

      const resolved = resolveOpenTarget(config, task, input.action);
      if ("error" in resolved) {
        return resolved;
      }

      const opened = resolved.kind === "reasonix_gui"
        ? await openExecutable(resolved.path, resolved.args ?? [], { cwd: resolved.cwd, env: resolved.env })
        : await openPath(resolved.path);
      if (!opened.ok) {
        return { error: opened.error ?? "Failed to open local path." };
      }

      return {
        task_id: task.task_id,
        action: input.action,
        opened: true,
        target_kind: resolved.kind,
        target_name: basename(resolved.path) || resolved.kind,
        message: buildOpenedMessage(resolved.kind),
      };
    },
  };
}

export function resolveOpenTarget(
  config: DaemonConfig,
  task: TaskState,
  action: TaskOpenAction,
): ResolvedTarget | { error: string } {
  if (action === "task_folder") {
    return resolveTaskFolderTarget(config, task);
  }
  if (action === "session_folder") {
    return resolveSessionFolderTarget(config, task);
  }
  if (action === "reasonix_gui") {
    return resolveReasonixGuiTarget(config, task);
  }
  return { error: "Unsupported open action." };
}

function resolveTaskFolderTarget(config: DaemonConfig, task: TaskState): ResolvedTarget | { error: string } {
  const worktreePath = task.worktree?.worktree_path;
  if (worktreePath && existsDirectory(worktreePath)) {
    const worktreesRoot = task.worktree?.worktrees_root;
    if (!worktreesRoot || !isInside(worktreesRoot, worktreePath)) {
      return { error: "Task Worktree path failed safety validation." };
    }
    return { kind: "worktree", path: resolve(worktreePath) };
  }

  const workspacePath = task.config.workspace_path;
  if (!existsDirectory(workspacePath)) {
    return { error: "Original workspace folder no longer exists." };
  }

  const allowedRoots = config.mcpConfig?.allowedRoots ?? [];
  if (allowedRoots.length === 0 || !allowedRoots.some((root) => isInside(root, workspacePath))) {
    return { error: "Original workspace is outside configured allowedRoots." };
  }

  return { kind: "workspace", path: resolve(workspacePath) };
}

function resolveSessionFolderTarget(config: DaemonConfig, task: TaskState): ResolvedTarget | { error: string } {
  if (task.agent !== "reasonix-tui") {
    return { error: "Only Reasonix TUI tasks have a Reasonix session folder target." };
  }
  if (!task.agent_session_path) {
    return { error: "This Reasonix task has no recorded session file." };
  }

  const agent = config.agents.find((candidate) => candidate.id === task.agent);
  if (!agent?.home_dir) {
    return { error: "Reasonix home_dir is not configured; cannot validate session path." };
  }

  const sessionPath = resolve(task.agent_session_path);
  if (!existsFile(sessionPath)) {
    return { error: "Reasonix session file no longer exists." };
  }
  if (!isInside(agent.home_dir, sessionPath)) {
    return { error: "Reasonix session file is outside configured REASONIX_HOME." };
  }

  const folder = dirname(sessionPath);
  if (!existsDirectory(folder)) {
    return { error: "Reasonix session folder no longer exists." };
  }
  return { kind: "reasonix_session_folder", path: folder };
}

function resolveReasonixGuiTarget(config: DaemonConfig, task: TaskState): ResolvedTarget | { error: string } {
  if (task.agent !== "reasonix-tui") {
    return { error: "Only Reasonix TUI tasks can open the Reasonix GUI companion." };
  }

  const tuiAgent = config.agents.find((candidate) => candidate.id === task.agent || candidate.kind === "reasonix-tui");
  const guiAgent = config.agents.find((candidate) => candidate.kind === "reasonix-gui" && candidate.enabled !== false && Boolean(candidate.command));
  const command = guiAgent?.command ? resolve(guiAgent.command) : inferReasonixGuiCommand(tuiAgent);
  if (!command) {
    return { error: "Reasonix GUI command is not configured and could not be inferred from Reasonix TUI settings." };
  }
  if (!existsFile(command)) {
    return { error: "Reasonix GUI executable does not exist." };
  }

  const homeDir = guiAgent?.home_dir ?? tuiAgent?.home_dir;
  if (!homeDir) {
    return { error: "Reasonix home_dir is not configured; cannot open GUI against the shared task session store." };
  }
  const resolvedHome = resolve(homeDir);
  if (!existsDirectory(resolvedHome)) {
    return { error: "Configured Reasonix home_dir no longer exists." };
  }

  return {
    kind: "reasonix_gui",
    path: command,
    args: guiAgent?.command_args ?? [],
    cwd: dirname(command),
    env: {
      ...process.env,
      REASONIX_HOME: resolvedHome,
      REASONIX_LANG: process.env.REASONIX_LANG || "zh",
    },
  };
}

function inferReasonixGuiCommand(agent: AgentConfig | undefined): string | null {
  if (agent?.home_dir) {
    return resolve(agent.home_dir, "..", "ReasonixDesktop", "reasonix-desktop.exe");
  }
  if (agent?.command) {
    return resolve(dirname(dirname(agent.command)), "ReasonixDesktop", "reasonix-desktop.exe");
  }
  return null;
}

function existsDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
}

function buildOpenedMessage(kind: OpenTaskTargetResult["target_kind"]): string {
  if (kind === "worktree") {
    return "Opened the task Worktree folder.";
  }
  if (kind === "workspace") {
    return "Opened the original workspace folder.";
  }
  if (kind === "reasonix_gui") {
    return "Opened the Reasonix GUI with the configured REASONIX_HOME.";
  }
  return "Opened the Reasonix session folder.";
}

async function defaultOpenPath(pathToOpen: string): Promise<OpenPathResult> {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  return new Promise((resolvePromise) => {
    try {
      const child = spawn(command, [pathToOpen], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.once("error", (error) => resolvePromise({ ok: false, error: error.message }));
      child.unref();
      resolvePromise({ ok: true });
    } catch (error) {
      resolvePromise({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function defaultOpenExecutable(command: string, args: string[], options: OpenExecutableOptions): Promise<OpenPathResult> {
  return new Promise((resolvePromise) => {
    try {
      const child = spawn(command, args, {
        cwd: options.cwd,
        detached: true,
        env: options.env,
        stdio: "ignore",
        windowsHide: false,
      });
      child.once("error", (error) => resolvePromise({ ok: false, error: error.message }));
      child.unref();
      resolvePromise({ ok: true });
    } catch (error) {
      resolvePromise({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
