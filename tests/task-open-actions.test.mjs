import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildExecutableLaunch, createOpenTaskTargetHandler, resolveOpenTarget } from "../apps/local-daemon/dist/apps/local-daemon/src/task-open-actions.js";
import { TaskStore } from "../dist/services/task-store.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "task-open-actions-"));
}

function daemonConfig(root, agents = []) {
  return {
    host: "127.0.0.1",
    port: 3210,
    runtimeDir: join(root, "runtime"),
    configError: null,
    mimoVersion: null,
    mcpConfig: {
      mimoNodePath: process.execPath,
      mimoEntryPath: "fake-mimo.mjs",
      allowedRoots: [join(root, "repo")],
      runtimeDir: join(root, "runtime"),
      agents,
    },
    agents,
  };
}

test("resolveOpenTarget prefers active worktree for task folder", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const worktreesRoot = join(runtime, "worktrees");
    const worktree = join(worktreesRoot, "repo", "task_abcdef123456");
    mkdirSync(repo, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open folder",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    store.updateTaskWorktree(task.task_id, {
      repo_path: repo,
      worktrees_root: worktreesRoot,
      worktree_path: worktree,
      branch_name: "task/test",
      base_commit: "base",
      base_branch: "master",
      diff_summary: null,
      out_of_bounds_files: [],
      has_out_of_bounds_changes: false,
    });

    const resolved = resolveOpenTarget(daemonConfig(root), store.getTask(task.task_id), "task_folder");
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "worktree");
    assert.strictEqual(resolved.path, resolve(worktree));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget falls back to allowed workspace when worktree is gone", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    mkdirSync(repo, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open workspace",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });

    const resolved = resolveOpenTarget(daemonConfig(root), task, "task_folder");
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "workspace");
    assert.strictEqual(resolved.path, resolve(repo));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget rejects workspace outside allowed roots", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const outside = join(root, "outside");
    const runtime = join(root, "runtime");
    mkdirSync(repo, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "blocked",
      workspace_path: outside,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });

    const resolved = resolveOpenTarget(daemonConfig(root), task, "task_folder");
    assert.ok("error" in resolved);
    assert.match(resolved.error, /allowedRoots/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget opens Reasonix session folder only under configured home", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const reasonixHome = join(root, "ReasonixData");
    const sessionDir = join(reasonixHome, "projects", "repo", "sessions");
    const sessionPath = join(sessionDir, "session.jsonl");
    mkdirSync(repo, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(sessionPath, "{}\n", "utf-8");
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "session folder",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    }, { agent: "reasonix-tui" });
    store.updateTaskAgentSession(task.task_id, sessionPath);

    const resolved = resolveOpenTarget(
      daemonConfig(root, [{ id: "reasonix-tui", kind: "reasonix-tui", display_name: "Reasonix TUI", enabled: true, home_dir: reasonixHome }]),
      store.getTask(task.task_id),
      "session_folder"
    );
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "reasonix_session_folder");
    assert.strictEqual(resolved.path, resolve(sessionDir));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget infers Reasonix GUI from TUI home for Reasonix tasks", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const reasonixRoot = join(root, "Reasonix");
    const reasonixHome = join(reasonixRoot, "ReasonixData");
    const guiDir = join(reasonixRoot, "ReasonixDesktop");
    const guiPath = join(guiDir, "reasonix-desktop.exe");
    mkdirSync(repo, { recursive: true });
    mkdirSync(reasonixHome, { recursive: true });
    mkdirSync(guiDir, { recursive: true });
    writeFileSync(guiPath, "", "utf-8");
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open gui",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    }, { agent: "reasonix-tui" });

    const resolved = resolveOpenTarget(
      daemonConfig(root, [{ id: "reasonix-tui", kind: "reasonix-tui", display_name: "Reasonix TUI", enabled: true, home_dir: reasonixHome }]),
      task,
      "reasonix_gui"
    );
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "reasonix_gui");
    assert.strictEqual(resolved.path, resolve(guiPath));
    assert.strictEqual(resolved.env.REASONIX_HOME, resolve(reasonixHome));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget prefers explicit Reasonix GUI agent command", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const reasonixHome = join(root, "ReasonixData");
    const explicitGuiDir = join(root, "ExplicitGui");
    const explicitGui = join(explicitGuiDir, "reasonix-desktop.exe");
    mkdirSync(repo, { recursive: true });
    mkdirSync(reasonixHome, { recursive: true });
    mkdirSync(explicitGuiDir, { recursive: true });
    writeFileSync(explicitGui, "", "utf-8");
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open explicit gui",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    }, { agent: "reasonix-tui" });

    const resolved = resolveOpenTarget(
      daemonConfig(root, [
        { id: "reasonix-tui", kind: "reasonix-tui", display_name: "Reasonix TUI", enabled: true, home_dir: reasonixHome },
        { id: "reasonix-gui", kind: "reasonix-gui", display_name: "Reasonix GUI", enabled: true, command: explicitGui, home_dir: reasonixHome },
      ]),
      task,
      "reasonix_gui"
    );
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "reasonix_gui");
    assert.strictEqual(resolved.path, resolve(explicitGui));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget rejects Reasonix GUI action for non-Reasonix tasks", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    mkdirSync(repo, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "blocked gui",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });

    const resolved = resolveOpenTarget(daemonConfig(root), task, "reasonix_gui");
    assert.ok("error" in resolved);
    assert.match(resolved.error, /Reasonix TUI tasks/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget builds fixed MiMo session terminal command", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const mimoEntry = join(root, "mimo-cli.mjs");
    mkdirSync(repo, { recursive: true });
    writeFileSync(mimoEntry, "", "utf-8");
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open mimo terminal",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    }, { session_id: "ses_terminal_123" });

    const resolved = resolveOpenTarget(
      {
        ...daemonConfig(root),
        mcpConfig: {
          ...daemonConfig(root).mcpConfig,
          mimoEntryPath: mimoEntry,
        },
      },
      task,
      "mimo_session_terminal"
    );
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "mimo_session_terminal");
    assert.strictEqual(resolved.path, "cmd.exe");
    assert.strictEqual(resolved.cwd, resolve(repo));
    assert.ok(resolved.args[1].includes("ses_terminal_123"));
    assert.ok(resolved.args[1].includes(resolve(mimoEntry)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget rejects MiMo terminal without a valid session id", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    mkdirSync(repo, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "blocked terminal",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });

    const resolved = resolveOpenTarget(daemonConfig(root), task, "mimo_session_terminal");
    assert.ok("error" in resolved);
    assert.match(resolved.error, /session_id/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOpenTarget builds fixed Reasonix session terminal command", () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const reasonixHome = join(root, "ReasonixData");
    const reasonixBin = join(root, "bin", "reasonix.exe");
    const sessionDir = join(reasonixHome, "projects", "repo", "sessions");
    const sessionPath = join(sessionDir, "session.jsonl");
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(root, "bin"), { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(reasonixBin, "", "utf-8");
    writeFileSync(sessionPath, "{}\n", "utf-8");
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open reasonix terminal",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    }, { agent: "reasonix-tui" });
    store.updateTaskAgentSession(task.task_id, sessionPath);

    const resolved = resolveOpenTarget(
      daemonConfig(root, [{ id: "reasonix-tui", kind: "reasonix-tui", display_name: "Reasonix TUI", enabled: true, command: reasonixBin, home_dir: reasonixHome }]),
      store.getTask(task.task_id),
      "reasonix_session_terminal"
    );
    assert.ok(!("error" in resolved));
    assert.strictEqual(resolved.kind, "reasonix_session_terminal");
    assert.strictEqual(resolved.path, "cmd.exe");
    assert.strictEqual(resolved.cwd, resolve(repo));
    assert.ok(resolved.args[1].includes("--resume"));
    assert.ok(resolved.args[1].includes(resolve(sessionPath)));
    assert.strictEqual(resolved.env.REASONIX_HOME, resolve(reasonixHome));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createOpenTaskTargetHandler opens resolved target without returning local path", async () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    mkdirSync(repo, { recursive: true });
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    const opened = [];
    const handler = createOpenTaskTargetHandler(daemonConfig(root), store, {
      openPath: (path) => {
        opened.push(path);
        return { ok: true };
      },
    });

    const result = await handler.handler({ task_id: task.task_id, action: "task_folder" });
    assert.ok(!("error" in result));
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(result.opened, true);
    assert.strictEqual(JSON.stringify(result).includes(repo), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createOpenTaskTargetHandler opens Reasonix GUI without returning executable path", async () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const reasonixRoot = join(root, "Reasonix");
    const reasonixHome = join(reasonixRoot, "ReasonixData");
    const guiDir = join(reasonixRoot, "ReasonixDesktop");
    const guiPath = join(guiDir, "reasonix-desktop.exe");
    mkdirSync(repo, { recursive: true });
    mkdirSync(reasonixHome, { recursive: true });
    mkdirSync(guiDir, { recursive: true });
    writeFileSync(guiPath, "", "utf-8");
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open gui handler",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    }, { agent: "reasonix-tui" });
    const opened = [];
    const handler = createOpenTaskTargetHandler(
      daemonConfig(root, [{ id: "reasonix-tui", kind: "reasonix-tui", display_name: "Reasonix TUI", enabled: true, home_dir: reasonixHome }]),
      store,
      {
        openExecutable: (command, args, options) => {
          opened.push({ command, args, options });
          return { ok: true };
        },
      }
    );

    const result = await handler.handler({ task_id: task.task_id, action: "reasonix_gui" });
    assert.ok(!("error" in result));
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(opened[0].command, resolve(guiPath));
    assert.deepStrictEqual(opened[0].args, []);
    assert.strictEqual(opened[0].options.env.REASONIX_HOME, resolve(reasonixHome));
    assert.strictEqual(result.opened, true);
    assert.strictEqual(result.target_kind, "reasonix_gui");
    assert.strictEqual(JSON.stringify(result).includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createOpenTaskTargetHandler marks MiMo session terminal as visible", async () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const mimoEntry = join(root, "mimo-cli.mjs");
    mkdirSync(repo, { recursive: true });
    writeFileSync(mimoEntry, "", "utf-8");
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open visible mimo terminal",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    }, { session_id: "ses_terminal_visible" });
    const opened = [];
    const handler = createOpenTaskTargetHandler(
      {
        ...daemonConfig(root),
        mcpConfig: {
          ...daemonConfig(root).mcpConfig,
          mimoEntryPath: mimoEntry,
        },
      },
      store,
      {
        openExecutable: (command, args, options) => {
          opened.push({ command, args, options });
          return { ok: true };
        },
      }
    );

    const result = await handler.handler({ task_id: task.task_id, action: "mimo_session_terminal" });
    assert.ok(!("error" in result));
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(opened[0].command, "cmd.exe");
    assert.strictEqual(opened[0].options.visibleTerminal, true);
    assert.strictEqual(result.target_kind, "mimo_session_terminal");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createOpenTaskTargetHandler marks Reasonix session terminal as visible", async () => {
  const root = tmpDir();
  try {
    const repo = join(root, "repo");
    const runtime = join(root, "runtime");
    const reasonixHome = join(root, "ReasonixData");
    const reasonixBin = join(root, "bin", "reasonix.exe");
    const sessionDir = join(reasonixHome, "projects", "repo", "sessions");
    const sessionPath = join(sessionDir, "session.jsonl");
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(root, "bin"), { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(reasonixBin, "", "utf-8");
    writeFileSync(sessionPath, "{}\n", "utf-8");
    const store = new TaskStore(runtime);
    const task = store.createTask({
      objective: "open visible reasonix terminal",
      workspace_path: repo,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    }, { agent: "reasonix-tui" });
    store.updateTaskAgentSession(task.task_id, sessionPath);
    const opened = [];
    const handler = createOpenTaskTargetHandler(
      daemonConfig(root, [{ id: "reasonix-tui", kind: "reasonix-tui", display_name: "Reasonix TUI", enabled: true, command: reasonixBin, home_dir: reasonixHome }]),
      store,
      {
        openExecutable: (command, args, options) => {
          opened.push({ command, args, options });
          return { ok: true };
        },
      }
    );

    const result = await handler.handler({ task_id: task.task_id, action: "reasonix_session_terminal" });
    assert.ok(!("error" in result));
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(opened[0].command, "cmd.exe");
    assert.strictEqual(opened[0].options.visibleTerminal, true);
    assert.strictEqual(opened[0].options.env.REASONIX_HOME, resolve(reasonixHome));
    assert.strictEqual(result.target_kind, "reasonix_session_terminal");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildExecutableLaunch verifies visible CMD creation on Windows", () => {
  if (process.platform !== "win32") {
    return;
  }
  const launch = buildExecutableLaunch("cmd.exe", ["/k", "echo hello"], {
    cwd: process.cwd(),
    env: { REASONIX_HOME: "C:\\ReasonixData", REASONIX_LANG: "zh" },
    visibleTerminal: true,
  });
  assert.strictEqual(launch.command, "powershell.exe");
  assert.strictEqual(launch.windowsHide, true);
  assert.strictEqual(launch.waitForExit, true);
  const encoded = launch.args[launch.args.length - 1];
  const script = Buffer.from(encoded, "base64").toString("utf16le");
  assert.match(script, /Start-Process/);
  assert.match(script, /-WindowStyle Normal/);
  assert.match(script, /-PassThru/);
  assert.match(script, /process\.Id/);
});
