import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { DaemonConfig } from "./daemon-config.js";

export interface WorkspaceFolderSelection {
  selected: boolean;
  path?: string;
  message: string;
}

export interface WorkspaceFolderPickerDependencies {
  runPowerShell?: (script: string, timeoutMs: number) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
}

export async function selectWorkspaceFolder(
  config: DaemonConfig,
  dependencies: WorkspaceFolderPickerDependencies = {},
): Promise<WorkspaceFolderSelection | { error: string }> {
  if (process.platform !== "win32") {
    return { error: "Workspace folder picker is currently supported only on Windows." };
  }

  const initialPath = resolveInitialPath(config);
  const script = buildFolderPickerScript(initialPath);
  const runner = dependencies.runPowerShell ?? runPowerShell;
  const result = await runner(script, 10 * 60 * 1000);

  if (result.exitCode === 2) {
    return { selected: false, message: "User cancelled folder selection." };
  }
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || "Folder picker failed.").trim();
    return { error: detail };
  }

  const selected = result.stdout.trim();
  if (!selected) {
    return { selected: false, message: "No folder selected." };
  }
  if (!existsDirectory(selected)) {
    return { error: "Selected folder no longer exists." };
  }

  return {
    selected: true,
    path: resolve(selected),
    message: "Workspace folder selected.",
  };
}

export function buildFolderPickerScript(initialPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择 AgentBridge Local 工作区文件夹'",
    "$dialog.ShowNewFolderButton = $false",
    `if (Test-Path -LiteralPath ${toPowerShellString(initialPath)}) { $dialog.SelectedPath = ${toPowerShellString(initialPath)} }`,
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath; exit 0 }",
    "exit 2",
  ].join("\n");
}

async function runPowerShell(script: string, timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolvePromise) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: false,
      },
      (error, stdout, stderr) => {
        if (error && typeof (error as NodeJS.ErrnoException).code === "string") {
          resolvePromise({ exitCode: null, stdout: stdout ?? "", stderr: (stderr ?? "") || error.message });
          return;
        }
        resolvePromise({
          exitCode: typeof (error as { code?: number } | null)?.code === "number" ? (error as { code: number }).code : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
  });
}

function resolveInitialPath(config: DaemonConfig): string {
  const allowedRoots = config.mcpConfig?.allowedRoots ?? [];
  for (const root of allowedRoots) {
    if (existsDirectory(root)) {
      return resolve(root);
    }
  }
  return process.cwd();
}

function existsDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function toPowerShellString(value: string): string {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
