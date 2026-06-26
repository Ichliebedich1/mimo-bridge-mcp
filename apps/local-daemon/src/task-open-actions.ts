import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { TaskStore } from "../../../src/services/task-store.js";
import { validateSessionId } from "../../../src/services/path-guard.js";
import type { AgentConfig, TaskState } from "../../../src/types.js";
import type { DaemonConfig } from "./daemon-config.js";

export type TaskOpenAction = "task_folder" | "session_folder" | "reasonix_gui" | "mimo_session_terminal" | "reasonix_session_terminal";

export interface OpenTaskTargetInput {
  task_id: string;
  action: TaskOpenAction;
}

export interface OpenTaskTargetResult {
  task_id: string;
  action: TaskOpenAction;
  opened: boolean;
  target_kind: "worktree" | "workspace" | "reasonix_session_folder" | "reasonix_gui" | "mimo_session_terminal" | "reasonix_session_terminal";
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
  visibleTerminal?: boolean;
}

interface ResolvedTarget {
  kind: OpenTaskTargetResult["target_kind"];
  path: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  visibleTerminal?: boolean;
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

      const opened = isExecutableTarget(resolved.kind)
        ? await openExecutable(resolved.path, resolved.args ?? [], { cwd: resolved.cwd, env: resolved.env, visibleTerminal: resolved.visibleTerminal })
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
  if (action === "mimo_session_terminal") {
    return resolveMimoSessionTerminalTarget(config, task);
  }
  if (action === "reasonix_session_terminal") {
    return resolveReasonixSessionTerminalTarget(config, task);
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

function resolveMimoSessionTerminalTarget(config: DaemonConfig, task: TaskState): ResolvedTarget | { error: string } {
  if (task.agent !== "mimo") {
    return { error: "Only MiMo tasks can open a MiMo session terminal." };
  }
  if (!task.session_id) {
    return { error: "This MiMo task has no recorded session_id." };
  }
  const sessionValidation = validateSessionId(task.session_id);
  if (!sessionValidation.allowed) {
    return { error: sessionValidation.reason ?? "Invalid MiMo session_id." };
  }
  const mcpConfig = config.mcpConfig;
  if (!mcpConfig) {
    return { error: "MiMo configuration is unavailable." };
  }
  const nodePath = resolve(mcpConfig.mimoNodePath);
  const entryPath = resolve(mcpConfig.mimoEntryPath);
  if (!existsFile(nodePath)) {
    return { error: "Configured MiMo Node executable does not exist." };
  }
  if (!existsFile(entryPath)) {
    return { error: "Configured MiMo entry file does not exist." };
  }

  const cwdTarget = resolveTaskFolderTarget(config, task);
  if ("error" in cwdTarget) {
    return cwdTarget;
  }

  const command = buildCmdCommand(cwdTarget.path, [nodePath, entryPath, "-s", task.session_id]);
  if ("error" in command) {
    return command;
  }
  return {
    kind: "mimo_session_terminal",
    path: "cmd.exe",
    args: ["/k", command.command],
    cwd: cwdTarget.path,
    env: process.env,
    visibleTerminal: true,
  };
}

function resolveReasonixSessionTerminalTarget(config: DaemonConfig, task: TaskState): ResolvedTarget | { error: string } {
  if (task.agent !== "reasonix-tui") {
    return { error: "Only Reasonix TUI tasks can open a Reasonix session terminal." };
  }
  const sessionTarget = resolveReasonixSessionFile(config, task);
  if ("error" in sessionTarget) {
    return sessionTarget;
  }
  const agent = sessionTarget.agent;
  if (!agent.command) {
    return { error: "Reasonix command is not configured." };
  }
  const commandPath = resolve(agent.command);
  if (!existsFile(commandPath)) {
    return { error: "Reasonix executable does not exist." };
  }
  const cwdTarget = resolveTaskFolderTarget(config, task);
  if ("error" in cwdTarget) {
    return cwdTarget;
  }

  const command = buildCmdCommand(cwdTarget.path, [commandPath, ...(agent.command_args ?? []), "run", "--resume", sessionTarget.sessionPath]);
  if ("error" in command) {
    return command;
  }
  return {
    kind: "reasonix_session_terminal",
    path: "cmd.exe",
    args: ["/k", command.command],
    cwd: cwdTarget.path,
    env: {
      ...process.env,
      ...(agent.home_dir ? { REASONIX_HOME: resolve(agent.home_dir) } : {}),
      REASONIX_LANG: process.env.REASONIX_LANG || "zh",
    },
    visibleTerminal: true,
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

function resolveReasonixSessionFile(
  config: DaemonConfig,
  task: TaskState,
): { agent: AgentConfig; sessionPath: string } | { error: string } {
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

  return { agent, sessionPath };
}

function isExecutableTarget(kind: OpenTaskTargetResult["target_kind"]): boolean {
  return kind === "reasonix_gui" || kind === "mimo_session_terminal" || kind === "reasonix_session_terminal";
}

function buildCmdCommand(cwd: string, commandAndArgs: string[]): { command: string } | { error: string } {
  const parts = [`cd /d ${quoteCmdArg(cwd)}`];
  const quoted = commandAndArgs.map(quoteCmdArg);
  if (quoted.some((item) => item === null)) {
    return { error: "Cannot open terminal because a command argument contains an unsafe quote character." };
  }
  parts.push(quoted.join(" "));
  return { command: parts.join(" && ") };
}

function quoteCmdArg(value: string): string | null {
  if (value.includes("\"")) {
    return null;
  }
  return `"${value}"`;
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
      const launch = buildExecutableLaunch(command, args, options);
      const child = spawn(launch.command, launch.args, {
        cwd: options.cwd,
        detached: true,
        env: launch.env,
        stdio: "ignore",
        windowsHide: launch.windowsHide,
      });
      child.once("error", (error) => resolvePromise({ ok: false, error: error.message }));
      child.unref();
      resolvePromise({ ok: true });
    } catch (error) {
      resolvePromise({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function buildExecutableLaunch(
  command: string,
  args: string[],
  options: OpenExecutableOptions,
): { command: string; args: string[]; env?: NodeJS.ProcessEnv; windowsHide: boolean } {
  if (process.platform !== "win32" || !options.visibleTerminal) {
    return { command, args, env: options.env, windowsHide: false };
  }

  const script = [
    `$env:REASONIX_HOME = ${toPowerShellString(options.env?.REASONIX_HOME)}`,
    `$env:REASONIX_LANG = ${toPowerShellString(options.env?.REASONIX_LANG ?? process.env.REASONIX_LANG ?? "zh")}`,
    `$argumentList = @(${args.map(toPowerShellString).join(", ")})`,
    `Start-Process -FilePath ${toPowerShellString(command)} -ArgumentList $argumentList -WorkingDirectory ${toPowerShellString(options.cwd ?? process.cwd())} -WindowStyle Normal`,
  ].join("; ");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    env: options.env,
    windowsHide: true,
  };
}

function toPowerShellString(value: string | undefined): string {
  return "'" + String(value ?? "").replace(/'/g, "''") + "'";
}
