import { existsSync } from "node:fs";
import { stderr as errorOutput, stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PersistentConfig } from "./daemon-config.js";
import {
  LauncherController,
  getCodexMcpEndpoint,
  type LauncherResult,
  type LauncherStatus,
} from "./launcher-controller.js";

interface CliFlags {
  json: boolean;
  open: boolean;
  lines: number;
}

export async function runLauncherCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = normalizeCommand(argv[0]);
  const flags = parseFlags(argv);
  const controller = new LauncherController();

  if (command === "help") {
    printHelp();
    return 0;
  }

  if (command === "menu") {
    return runMenu(controller);
  }

  if (command === "start") {
    return printResult(await controller.start({ openUi: flags.open }), flags);
  }

  if (command === "stop") {
    return printResult(await controller.stop(), flags);
  }

  if (command === "restart") {
    return printResult(await controller.restart({ openUi: flags.open }), flags);
  }

  if (command === "status") {
    return printStatus(await controller.status(), flags);
  }

  if (command === "logs") {
    return printLogs(controller.readLogs({ maxLines: flags.lines }), flags);
  }

  if (command === "open") {
    return printResult(await controller.openUi(), flags);
  }

  if (command === "configure") {
    return runConfigureWizard(controller);
  }

  if (command === "shortcut") {
    return printResult(controller.createDesktopShortcut(), flags);
  }

  if (command === "autostart") {
    const action = argv[1] ?? "status";
    if (action === "enable") {
      return printResult(controller.setAutostart(true), flags);
    }
    if (action === "disable") {
      return printResult(controller.setAutostart(false), flags);
    }
    return printResult(controller.getAutostartStatus(), flags);
  }

  if (command === "mcp-info") {
    const status = await controller.status();
    const port = status.data?.port ?? 3210;
    const result: LauncherResult = {
      ok: true,
      status: "mcp_info",
      message: "Codex MCP 地址：" + getCodexMcpEndpoint(port),
      data: { endpoint: getCodexMcpEndpoint(port) },
    };
    return printResult(result, flags);
  }

  console.error("未知命令：" + command);
  printHelp();
  return 1;
}

async function runMenu(controller: LauncherController): Promise<number> {
  const rl = createInterface({ input, output });
  let rlOpen = true;
  try {
    for (;;) {
      console.log("");
      console.log("MiMo Bridge Launcher");
      console.log("1. 启动 daemon 并打开 UI");
      console.log("2. 停止 daemon");
      console.log("3. 重启 daemon 并打开 UI");
      console.log("4. 查看状态");
      console.log("5. 查看最近日志");
      console.log("6. 首次配置向导");
      console.log("7. 创建桌面快捷方式");
      console.log("8. 查看开机自启动状态");
      console.log("0. 退出");
      const answer = (await rl.question("请选择操作: ")).trim();
      if (answer === "0" || answer.toLowerCase() === "q") {
        return 0;
      }
      if (answer === "1") {
        await printResult(await controller.start({ openUi: true }), { json: false, open: false, lines: 80 });
      } else if (answer === "2") {
        await printResult(await controller.stop(), { json: false, open: false, lines: 80 });
      } else if (answer === "3") {
        await printResult(await controller.restart({ openUi: true }), { json: false, open: false, lines: 80 });
      } else if (answer === "4") {
        await printStatus(await controller.status(), { json: false, open: false, lines: 80 });
      } else if (answer === "5") {
        printLogs(controller.readLogs({ maxLines: 80 }), { json: false, open: false, lines: 80 });
      } else if (answer === "6") {
        rl.close();
        rlOpen = false;
        return runConfigureWizard(controller);
      } else if (answer === "7") {
        printResult(controller.createDesktopShortcut(), { json: false, open: false, lines: 80 });
      } else if (answer === "8") {
        printResult(controller.getAutostartStatus(), { json: false, open: false, lines: 80 });
      } else {
        console.log("没有这个选项。");
      }
    }
  } finally {
    if (rlOpen) {
      rl.close();
    }
  }
}

async function runConfigureWizard(controller: LauncherController): Promise<number> {
  const rl = createInterface({ input, output });
  try {
    const existing = controller.readConfig().config ?? {};
    const paths = controller.getPaths();
    console.log("MiMo Bridge 首次配置向导");
    console.log("不会复制 MiMo 登录态、凭据、任务日志或 Git Worktree。");
    console.log("");
    const mimoNodePath = await askPath(rl, "MiMo 使用的 Node 路径", existing.mimoNodePath || process.env.MIMO_NODE_PATH || process.execPath);
    const mimoEntryPath = await askPath(rl, "MiMo CLI 入口 JS 路径", existing.mimoEntryPath || process.env.MIMO_ENTRY_PATH || "");
    const allowedRootDefault = Array.isArray(existing.allowedRoots) && existing.allowedRoots.length > 0 ? existing.allowedRoots.join(";") : process.cwd();
    const allowedRootsRaw = await askText(rl, "允许 MiMo 修改的项目根目录，多个用分号分隔", allowedRootDefault);
    const runtimeDir = await askText(rl, "运行数据目录", existing.runtimeDir || process.env.MIMO_RUNTIME_DIR || resolve(paths.dataDir, "runtime"));
    const portRaw = await askText(rl, "本地端口", String(existing.port || process.env.MIMO_DAEMON_PORT || 3210));
    const port = Number(portRaw);
    const config: PersistentConfig = {
      mimoNodePath,
      mimoEntryPath,
      allowedRoots: allowedRootsRaw.split(";").map((item) => item.trim()).filter(Boolean),
      runtimeDir,
      port,
    };
    const result = controller.writeConfig(config);
    const code = printResult(result, { json: false, open: false, lines: 80 });
    if (result.ok) {
      console.log("Codex MCP 配置地址：" + getCodexMcpEndpoint(port));
      console.log("下一步可运行 launcher.ps1 start --open。");
    }
    return code;
  } finally {
    rl.close();
  }
}

async function askPath(rl: ReturnType<typeof createInterface>, label: string, defaultValue: string): Promise<string> {
  for (;;) {
    const value = await askText(rl, label, defaultValue);
    if (existsSync(value)) {
      return value;
    }
    console.log("路径不存在：" + value);
  }
}

async function askText(rl: ReturnType<typeof createInterface>, label: string, defaultValue: string): Promise<string> {
  const suffix = defaultValue ? " [" + defaultValue + "]" : "";
  const answer = (await rl.question(label + suffix + ": ")).trim();
  return answer || defaultValue;
}

function printStatus(result: LauncherResult<LauncherStatus>, flags: CliFlags): number {
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  console.log(result.message);
  if (result.data) {
    console.log("状态：" + result.data.state);
    console.log("端口：" + result.data.port);
    console.log("管理界面：" + result.data.adminUrl);
    console.log("Codex MCP：" + result.data.codexMcpEndpoint);
    if (result.data.health.ok) {
      console.log("健康检查：通过");
    } else {
      console.log("健康检查：未通过 - " + (result.data.health.error || "未知错误"));
    }
    if (result.data.portOwner) {
      console.log("端口占用 PID：" + result.data.portOwner.pid);
      if (result.data.portOwner.name) {
        console.log("端口占用进程：" + result.data.portOwner.name);
      }
    }
  }
  return result.ok ? 0 : 1;
}

function printLogs(result: LauncherResult, flags: CliFlags): number {
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  console.log(result.message);
  const data = result.data as { stdout?: string; stderr?: string; stdoutLogPath?: string; stderrLogPath?: string; truncated?: boolean } | undefined;
  if (data) {
    console.log("stdout log: " + data.stdoutLogPath);
    console.log("stderr log: " + data.stderrLogPath);
    if (data.truncated) {
      console.log("日志已按行数和字符数截断。");
    }
    console.log("");
    console.log("[stdout]");
    console.log(data.stdout || "(空)");
    console.log("");
    console.log("[stderr]");
    console.log(data.stderr || "(空)");
  }
  return result.ok ? 0 : 1;
}

function printResult(result: LauncherResult, flags: CliFlags): number {
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.message);
    if (result.status === "started" || result.status === "already_running") {
      const data = result.data as { adminUrl?: string; codexMcpEndpoint?: string } | undefined;
      if (data?.adminUrl) {
        console.log("管理界面：" + data.adminUrl);
      }
      if (data?.codexMcpEndpoint) {
        console.log("Codex MCP：" + data.codexMcpEndpoint);
      }
    }
    if (!result.ok && result.details !== undefined) {
      console.log(JSON.stringify(result.details, null, 2));
    }
  }
  return result.ok ? 0 : 1;
}

function parseFlags(argv: string[]): CliFlags {
  const linesIndex = argv.indexOf("--lines");
  const parsedLines = linesIndex >= 0 && argv[linesIndex + 1] ? Number(argv[linesIndex + 1]) : 80;
  return {
    json: argv.includes("--json"),
    open: argv.includes("--open"),
    lines: Number.isInteger(parsedLines) ? parsedLines : 80,
  };
}

function normalizeCommand(raw: string | undefined): string {
  if (!raw || raw.startsWith("--")) {
    return "menu";
  }
  return raw;
}

function printHelp(): void {
  console.log("MiMo Bridge Launcher");
  console.log("");
  console.log("用法:");
  console.log("  launcher-cli.js start [--open] [--json]");
  console.log("  launcher-cli.js stop [--json]");
  console.log("  launcher-cli.js restart [--open] [--json]");
  console.log("  launcher-cli.js status [--json]");
  console.log("  launcher-cli.js logs [--lines 80] [--json]");
  console.log("  launcher-cli.js open");
  console.log("  launcher-cli.js configure");
  console.log("  launcher-cli.js shortcut");
  console.log("  launcher-cli.js autostart status|enable|disable");
  console.log("  launcher-cli.js mcp-info");
}

const isDirectRun = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isDirectRun) {
  runLauncherCli().then((code) => {
    return flushWritable(output).then(() => flushWritable(errorOutput)).then(() => {
      process.exitCode = code;
    });
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function flushWritable(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolveFlush) => {
    if (stream.write("")) {
      resolveFlush();
    } else {
      stream.once("drain", resolveFlush);
    }
  });
}
