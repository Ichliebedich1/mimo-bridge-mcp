import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentRegistry } from "../dist/services/agent-registry.js";

test("agent registry always exposes MiMo status", async () => {
  const registry = createAgentRegistry({
    agents: [],
    mcpConfig: {
      mimoNodePath: process.execPath,
      mimoEntryPath: "fake-mimo.mjs",
      allowedRoots: [process.cwd()],
      runtimeDir: process.cwd(),
      agents: [],
    },
    mimoVersion: { nodeVersion: "v-test", cliVersion: "mimo-test" },
  });

  const result = await registry.listAgents();
  const mimo = result.agents.find((agent) => agent.id === "mimo");
  assert.ok(mimo);
  assert.strictEqual(mimo.status, "ready");
  assert.strictEqual(mimo.version, "mimo-test");
  assert.strictEqual(mimo.capabilities.start_task, true);
  assert.strictEqual(mimo.capabilities.reply_task, true);
});

test("agent registry reports unconfigured Reasonix without throwing", async () => {
  const registry = createAgentRegistry({
    agents: [
      {
        id: "reasonix-tui",
        kind: "reasonix-tui",
        display_name: "Reasonix TUI",
        enabled: true,
      },
    ],
    mcpConfig: null,
    mimoVersion: null,
  });

  const result = await registry.listAgents();
  const reasonix = result.agents.find((agent) => agent.id === "reasonix-tui");
  assert.ok(reasonix);
  assert.strictEqual(reasonix.status, "not_configured");
    assert.strictEqual(reasonix.capabilities.start_task, false);
    assert.strictEqual(reasonix.capabilities.wait_task, false);
    assert.strictEqual(reasonix.capabilities.review_package, false);
});

test("agent registry probes Reasonix TUI with redacted doctor JSON", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "reasonix-agent-"));
  const fakeReasonix = join(tempDir, "fake-reasonix.mjs");
  const homeDir = join(tempDir, "ReasonixData");
  writeFileSync(fakeReasonix, `
const args = process.argv.slice(2);
if (args[0] === "version") {
  console.log("reasonix dev-test");
  process.exit(0);
}
if (args[0] === "doctor" && args[1] === "--json") {
  console.log(JSON.stringify({
    config: { default_model: "deepseek" },
    providers: [
      {
        name: "deepseek",
        kind: "openai",
        models: ["deepseek-v4-flash"],
        key_present: true,
        is_default: true,
        context_window: 1000000
      }
    ],
    sessions: { dir: process.env.REASONIX_HOME + "/sessions", count: 2, bytes: 1234 },
    permission: { mode: "ask" },
    sandbox: { available: false },
    warnings: ["legacy config ignored"]
  }));
  process.exit(0);
}
process.exit(2);
`, "utf-8");

  try {
    const registry = createAgentRegistry({
      agents: [
        {
          id: "reasonix-tui",
          kind: "reasonix-tui",
          display_name: "Reasonix TUI",
          enabled: true,
          command: process.execPath,
          command_args: [fakeReasonix],
          home_dir: homeDir,
        },
      ],
      mcpConfig: null,
      mimoVersion: null,
      env: {},
    });

    const result = await registry.listAgents();
    const reasonix = result.agents.find((agent) => agent.id === "reasonix-tui");
    assert.ok(reasonix);
    assert.strictEqual(reasonix.status, "ready");
    assert.strictEqual(reasonix.version, "dev-test");
    assert.strictEqual(reasonix.capabilities.start_task, true);
    assert.strictEqual(reasonix.capabilities.wait_task, true);
    assert.strictEqual(reasonix.capabilities.review_package, true);
    assert.strictEqual(reasonix.capabilities.reply_task, true);
    assert.strictEqual(reasonix.capabilities.token_usage, true);
    assert.strictEqual(reasonix.default_model, "deepseek");
    assert.strictEqual(reasonix.sessions.configured, true);
    assert.strictEqual(reasonix.sessions.count, 2);
    assert.strictEqual(reasonix.providers[0].name, "deepseek");
    assert.deepStrictEqual(reasonix.providers[0].models, ["deepseek-v4-flash"]);
    assert.strictEqual(reasonix.providers[0].key_present, true);
    assert.strictEqual(reasonix.permission_mode, "ask");
    assert.deepStrictEqual(reasonix.warnings, ["legacy config ignored"]);
    assert.strictEqual(JSON.stringify(reasonix).includes("api_key"), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent registry reports missing Reasonix command", async () => {
  const registry = createAgentRegistry({
    agents: [
      {
        id: "reasonix-tui",
        kind: "reasonix-tui",
        display_name: "Reasonix TUI",
        enabled: true,
        command: join(tmpdir(), "missing-reasonix.exe"),
      },
    ],
    mcpConfig: null,
    mimoVersion: null,
  });

  const result = await registry.listAgents();
  const reasonix = result.agents.find((agent) => agent.id === "reasonix-tui");
  assert.ok(reasonix);
  assert.strictEqual(reasonix.status, "missing");
  assert.match(reasonix.error, /does not exist/);
});

test("agent registry treats Reasonix GUI as viewer-only companion", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "reasonix-gui-agent-"));
  const fakeGui = join(tempDir, "reasonix-desktop.exe");
  writeFileSync(fakeGui, "", "utf-8");

  try {
    const registry = createAgentRegistry({
      agents: [
        {
          id: "reasonix-gui",
          kind: "reasonix-gui",
          display_name: "Reasonix GUI",
          enabled: true,
          command: fakeGui,
          home_dir: join(tempDir, "ReasonixData"),
        },
      ],
      mcpConfig: null,
      mimoVersion: null,
    });

    const result = await registry.listAgents();
    const gui = result.agents.find((agent) => agent.id === "reasonix-gui");
    assert.ok(gui);
    assert.strictEqual(gui.status, "ready");
    assert.strictEqual(gui.capabilities.start_task, false);
    assert.strictEqual(gui.capabilities.reply_task, false);
    assert.strictEqual(gui.capabilities.live_view, true);
    assert.strictEqual(gui.capabilities.worktree, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
