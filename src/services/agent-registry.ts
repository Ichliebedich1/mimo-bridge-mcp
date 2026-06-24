import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { Config, MimoVersion } from "../config.js";
import type { AgentCapabilityMap, AgentConfig, AgentProbeResult } from "../types.js";

const DEFAULT_REASONIX_TIMEOUT_MS = 10_000;

export interface AgentRegistryOptions {
  agents: AgentConfig[];
  mcpConfig: Config | null;
  mimoVersion: MimoVersion | null;
  env?: NodeJS.ProcessEnv;
}

export interface AgentRegistry {
  listAgents(): Promise<{ agents: AgentProbeResult[] }>;
}

export function createAgentRegistry(options: AgentRegistryOptions): AgentRegistry {
  const configs = dedupeAgents(options.agents);

  return {
    async listAgents() {
      const agents = configs.map((agent) => probeAgent(agent, options));
      return { agents };
    },
  };
}

function dedupeAgents(agents: AgentConfig[]): AgentConfig[] {
  const result: AgentConfig[] = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    if (!agent.id || seen.has(agent.id)) {
      continue;
    }
    seen.add(agent.id);
    result.push({
      ...agent,
      display_name: agent.display_name || agent.id,
      enabled: agent.enabled !== false,
    });
  }
  if (!seen.has("mimo")) {
    result.unshift({
      id: "mimo",
      kind: "mimo",
      display_name: "MiMo Code",
      enabled: true,
    });
  }
  return result;
}

function probeAgent(agent: AgentConfig, options: AgentRegistryOptions): AgentProbeResult {
  if (agent.enabled === false) {
    return baseProbe(agent, "disabled", "Agent is disabled.");
  }
  if (agent.kind === "mimo") {
    return probeMimo(agent, options);
  }
  if (agent.kind === "reasonix-tui") {
    return probeReasonixTui(agent, options.env ?? process.env);
  }
  if (agent.kind === "reasonix-gui") {
    return probeReasonixGui(agent);
  }
  return baseProbe(agent, "error", `Unsupported agent kind: ${agent.kind}`);
}

function probeMimo(agent: AgentConfig, options: AgentRegistryOptions): AgentProbeResult {
  const result = baseProbe(agent, options.mcpConfig ? "ready" : "not_configured", options.mcpConfig ? null : "MiMo is not configured.");
  result.version = options.mimoVersion?.cliVersion ?? null;
  result.default_model = null;
  result.capabilities = {
    start_task: Boolean(options.mcpConfig),
    wait_task: Boolean(options.mcpConfig),
    review_package: true,
    live_view: true,
    reply_task: Boolean(options.mcpConfig),
    token_usage: true,
    worktree: true,
  };
  return result;
}

function probeReasonixTui(agent: AgentConfig, env: NodeJS.ProcessEnv): AgentProbeResult {
  const result = baseProbe(agent, "not_configured", "Reasonix command is not configured.");
  result.capabilities = reasonixCapabilities(false);
  result.default_model = agent.default_model ?? null;
  result.models = agent.models ?? [];
  result.command_configured = Boolean(agent.command);
  result.home_configured = Boolean(agent.home_dir);

  if (!agent.command) {
    return result;
  }
  if (!existsSync(agent.command)) {
    result.status = "missing";
    result.error = "Reasonix command does not exist.";
    return result;
  }

  const commandArgs = agent.command_args ?? [];
  const childEnv = {
    ...env,
    ...(agent.home_dir ? { REASONIX_HOME: agent.home_dir } : {}),
    REASONIX_LANG: env.REASONIX_LANG || "zh",
  };

  try {
    const version = execText(agent.command, [...commandArgs, "version"], childEnv, DEFAULT_REASONIX_TIMEOUT_MS);
    result.version = normalizeVersion(version);
  } catch (error) {
    result.status = "error";
    result.error = `Reasonix version probe failed: ${errorToMessage(error)}`;
    return result;
  }

  try {
    const doctorRaw = execText(agent.command, [...commandArgs, "doctor", "--json"], childEnv, DEFAULT_REASONIX_TIMEOUT_MS);
    applyReasonixDoctor(result, doctorRaw);
    result.status = "ready";
    result.error = null;
    result.capabilities = reasonixCapabilities(true);
  } catch (error) {
    result.status = "error";
    result.error = `Reasonix doctor probe failed: ${errorToMessage(error)}`;
  }

  return result;
}

function probeReasonixGui(agent: AgentConfig): AgentProbeResult {
  const result = baseProbe(agent, "not_configured", "Reasonix GUI command is not configured.");
  result.capabilities = reasonixGuiCapabilities(false);
  result.command_configured = Boolean(agent.command);
  result.home_configured = Boolean(agent.home_dir);

  if (!agent.command) {
    return result;
  }
  if (!existsSync(agent.command)) {
    result.status = "missing";
    result.error = "Reasonix GUI command does not exist.";
    return result;
  }

  result.status = "ready";
  result.error = null;
  result.capabilities = reasonixGuiCapabilities(true);
  result.sessions = {
    configured: Boolean(agent.home_dir),
    count: null,
    bytes: null,
  };
  return result;
}

function reasonixGuiCapabilities(ready: boolean): AgentCapabilityMap {
  return {
    start_task: false,
    wait_task: false,
    review_package: false,
    live_view: ready,
    reply_task: false,
    token_usage: false,
    worktree: false,
  };
}

function execText(command: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): string {
  return execFileSync(command, args, {
    encoding: "utf-8",
    timeout,
    env,
    windowsHide: true,
    maxBuffer: 512 * 1024,
  }).trim();
}

function applyReasonixDoctor(result: AgentProbeResult, rawJson: string): void {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const config = readRecord(parsed.config);
  const sessions = readRecord(parsed.sessions);
  const permission = readRecord(parsed.permission);
  const sandbox = readRecord(parsed.sandbox);
  const providers = Array.isArray(parsed.providers) ? parsed.providers : [];

  result.default_model = readString(config.default_model) ?? result.default_model;
  result.providers = providers
    .filter((provider): provider is Record<string, unknown> => typeof provider === "object" && provider !== null)
    .map((provider) => ({
      name: readString(provider.name) ?? "unknown",
      kind: readString(provider.kind),
      models: readStringArray(provider.models, readString(provider.model)),
      key_present: readBoolean(provider.key_present),
      is_default: readBoolean(provider.is_default),
      context_window: readNumber(provider.context_window),
    }));
  if (result.models.length === 0) {
    result.models = [...new Set(result.providers.flatMap((provider) => provider.models))];
  }
  result.sessions = {
    configured: Boolean(readString(sessions.dir)),
    count: readNumber(sessions.count),
    bytes: readNumber(sessions.bytes),
  };
  result.permission_mode = readString(permission.mode);
  result.sandbox_available = readBoolean(sandbox.available);
  result.warnings = readStringArray(parsed.warnings);
}

function baseProbe(agent: AgentConfig, status: AgentProbeResult["status"], error: string | null): AgentProbeResult {
  return {
    id: agent.id,
    kind: agent.kind,
    display_name: agent.display_name || agent.id,
    enabled: agent.enabled !== false,
    status,
    version: null,
    default_model: null,
    models: [],
    command_configured: false,
    home_configured: false,
    sessions: { configured: false, count: null, bytes: null },
    providers: [],
    permission_mode: null,
    sandbox_available: null,
    capabilities: {
      start_task: false,
      wait_task: false,
      review_package: false,
      live_view: false,
      reply_task: false,
      token_usage: false,
      worktree: false,
    },
    warnings: [],
    error,
  };
}

function reasonixCapabilities(ready: boolean): AgentCapabilityMap {
  return {
    start_task: ready,
    wait_task: ready,
    review_package: ready,
    live_view: ready,
    reply_task: ready,
    token_usage: ready,
    worktree: true,
  };
}

function normalizeVersion(value: string): string {
  return value.replace(/^reasonix\s+/i, "").trim() || value.trim();
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown, fallback?: string | null): string[] {
  const result = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  if (result.length === 0 && fallback) {
    return [fallback];
  }
  return result;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
