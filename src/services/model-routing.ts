import type {
  AgentKind,
  ReasoningEffort,
  RoutingAgentId,
  RoutingConfig,
  RoutingMode,
  RoutingProfilesConfig,
  RoutingSelection,
  TaskScenario,
} from "../types.js";

export const TASK_SCENARIOS: TaskScenario[] = ["multimodal", "simple", "normal", "complex", "high_risk"];
export const REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];
export const MIMO_MODELS = ["mimo-v2.5-flash", "mimo-v2.5-pro"] as const;
export const MIMO_ULTRA_SPEED_MODEL = "mimo-v2.5-pro-ultra-speed" as const;
export const REASONIX_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;

export interface AgentRoutingProfile {
  model: string;
  reasoning_effort: ReasoningEffort;
  reason: string;
}

export interface ScenarioRoutingProfile {
  description: string;
  supports_multimodal: boolean;
  recommended: Record<RoutingAgentId, AgentRoutingProfile>;
  current: RoutingSelection;
}

export interface RoutingProfilesResponse {
  default_scenario: TaskScenario;
  scenarios: Record<TaskScenario, ScenarioRoutingProfile>;
  allowed_models: Record<RoutingAgentId, string[]>;
  reasoning_efforts: ReasoningEffort[];
  pricing_per_1m_cny: {
    flash: { input: number; output: number; cache_hit: number };
    pro: { input: number; output: number; cache_hit: number };
    ultra_speed: { input: number; output: number; cache_hit: number };
  };
}

const BASE_SCENARIOS: Record<TaskScenario, Omit<ScenarioRoutingProfile, "current"> & { default_current: RoutingSelection }> = {
  multimodal: {
    description: "多模态/图片任务",
    supports_multimodal: true,
    recommended: {
      mimo: { model: "mimo-v2.5-flash", reasoning_effort: "medium", reason: "只有 MiMo flash 支持多模态输入" },
      "reasonix-tui": { model: "deepseek-v4-flash", reasoning_effort: "medium", reason: "Reasonix 当前不支持多模态，仅作为文本任务参考" },
    },
    default_current: { agent_id: "mimo", model: "mimo-v2.5-flash", reasoning_effort: "medium" },
  },
  simple: {
    description: "简单文本、文档、小 UI 调整",
    supports_multimodal: false,
    recommended: {
      mimo: { model: "mimo-v2.5-flash", reasoning_effort: "low", reason: "简单任务优先用 flash 降低成本" },
      "reasonix-tui": { model: "deepseek-v4-flash", reasoning_effort: "low", reason: "简单任务优先用 flash 降低成本" },
    },
    default_current: { agent_id: "mimo", model: "mimo-v2.5-flash", reasoning_effort: "low" },
  },
  normal: {
    description: "普通代码任务",
    supports_multimodal: false,
    recommended: {
      mimo: { model: "mimo-v2.5-flash", reasoning_effort: "medium", reason: "普通任务默认用 flash，中等强度" },
      "reasonix-tui": { model: "deepseek-v4-flash", reasoning_effort: "medium", reason: "普通任务默认用 flash，中等强度" },
    },
    default_current: { agent_id: "mimo", model: "mimo-v2.5-flash", reasoning_effort: "medium" },
  },
  complex: {
    description: "复杂运行时、Git、安装包、安全边界任务",
    supports_multimodal: false,
    recommended: {
      mimo: { model: "mimo-v2.5-pro", reasoning_effort: "high", reason: "复杂任务用 pro 和高强度更稳" },
      "reasonix-tui": { model: "deepseek-v4-pro", reasoning_effort: "high", reason: "复杂任务用 pro 和高强度更稳" },
    },
    default_current: { agent_id: "mimo", model: "mimo-v2.5-pro", reasoning_effort: "high" },
  },
  high_risk: {
    description: "高风险修改、迁移、删除、权限和发布相关任务",
    supports_multimodal: false,
    recommended: {
      mimo: { model: "mimo-v2.5-pro", reasoning_effort: "high", reason: "高风险任务默认使用 pro 和高强度" },
      "reasonix-tui": { model: "deepseek-v4-pro", reasoning_effort: "high", reason: "高风险任务默认使用 pro 和高强度" },
    },
    default_current: { agent_id: "mimo", model: "mimo-v2.5-pro", reasoning_effort: "high" },
  },
};

export function getRoutingProfiles(config: RoutingProfilesConfig | undefined = undefined): RoutingProfilesResponse {
  const scenarios = {} as Record<TaskScenario, ScenarioRoutingProfile>;
  for (const scenario of TASK_SCENARIOS) {
    const base = BASE_SCENARIOS[scenario];
    const override = normalizeScenarioSelection(scenario, config?.scenarios?.[scenario], config) ?? base.default_current;
    scenarios[scenario] = {
      description: base.description,
      supports_multimodal: base.supports_multimodal,
      recommended: base.recommended,
      current: override,
    };
  }

  const mimoModels: string[] = [...MIMO_MODELS];
  if (config?.enable_mimo_pro_ultra_speed) {
    mimoModels.push(MIMO_ULTRA_SPEED_MODEL);
  }

  return {
    default_scenario: "normal",
    scenarios,
    allowed_models: {
      mimo: mimoModels,
      "reasonix-tui": [...REASONIX_MODELS],
    },
    reasoning_efforts: [...REASONING_EFFORTS],
    pricing_per_1m_cny: {
      flash: { input: 1, output: 3, cache_hit: 0.02 },
      pro: { input: 3, output: 6, cache_hit: 0.025 },
      ultra_speed: { input: 9, output: 18, cache_hit: 0.075 },
    },
  };
}

export function normalizeRoutingProfilesConfig(input: unknown): { ok: true; config: RoutingProfilesConfig } | { ok: false; error: string } {
  if (!isRecord(input)) {
    return { ok: false, error: "路由配置必须是 JSON 对象" };
  }
  const enableUltraSpeed = input.enable_mimo_pro_ultra_speed === true;
  const disableUltraSpeedExplicitly = Object.prototype.hasOwnProperty.call(input, "enable_mimo_pro_ultra_speed") && !enableUltraSpeed;
  const rawScenarios = isRecord(input.scenarios) ? input.scenarios : input;
  const scenarios: Partial<Record<TaskScenario, RoutingSelection>> = {};
  const configForValidation: RoutingProfilesConfig = { enable_mimo_pro_ultra_speed: enableUltraSpeed };

  for (const scenario of TASK_SCENARIOS) {
    const selection = normalizeScenarioSelection(scenario, rawScenarios[scenario], configForValidation);
    if (rawScenarios[scenario] !== undefined && !selection) {
      if (disableUltraSpeedExplicitly && isDisabledUltraSpeedSelection(rawScenarios[scenario])) {
        continue;
      }
      return { ok: false, error: `场景 ${scenario} 的路由配置无效` };
    }
    if (selection) {
      scenarios[scenario] = selection;
    }
  }

  return { ok: true, config: { scenarios, enable_mimo_pro_ultra_speed: enableUltraSpeed || undefined } };
}

export function resolveRouting(
  agentKind: AgentKind,
  options: {
    routing_mode?: RoutingMode;
    task_scenario?: TaskScenario;
    model?: string;
    reasoning_effort?: ReasoningEffort;
    has_images?: boolean;
  },
  profiles: RoutingProfilesConfig | undefined = undefined,
): { ok: true; config: RoutingConfig } | { ok: false; error: string } {
  const agentId = agentKindToRoutingAgent(agentKind);
  if (!agentId) {
    return { ok: false, error: `当前 Agent 不支持模型路由: ${agentKind}` };
  }

  const routingMode = options.routing_mode ?? "auto";
  const scenario = options.has_images ? "multimodal" : options.task_scenario ?? "normal";
  if (!TASK_SCENARIOS.includes(scenario)) {
    return { ok: false, error: `未知任务场景: ${scenario}` };
  }
  if (scenario === "multimodal" && agentId !== "mimo") {
    return { ok: false, error: "多模态任务只能使用 MiMo 的 mimo-v2.5-flash 模型" };
  }

  const defaultSelection = getSelectionForAgent(agentId, scenario, profiles);
  const model = options.model ?? defaultSelection.model;
  const effort = options.reasoning_effort ?? (routingMode === "manual" ? "medium" : defaultSelection.reasoning_effort);
  const modelValidation = validateModelForAgent(agentId, model, profiles);
  if (!modelValidation.ok) {
    return modelValidation;
  }
  if (scenario === "multimodal" && model !== "mimo-v2.5-flash") {
    return { ok: false, error: "多模态任务必须使用 mimo-v2.5-flash；mimo-v2.5-pro 和 mimo-v2.5-pro-ultra-speed 不支持多模态" };
  }

  const profile = getRoutingProfiles(profiles).scenarios[scenario];
  const reasonParts = [
    routingMode === "manual" ? "手动路由" : "自动路由",
    `场景=${scenario}(${profile.description})`,
    `Agent=${agentId}`,
    `模型=${model}`,
    `思考强度=${effort}`,
  ];
  if (options.model) reasonParts.push("用户指定模型");
  if (options.reasoning_effort) reasonParts.push("用户指定思考强度");
  if (options.has_images) reasonParts.push("检测到多模态需求");

  return {
    ok: true,
    config: {
      routing_mode: routingMode,
      task_scenario: scenario,
      agent_id: agentId,
      model,
      reasoning_effort: effort,
      routing_reason: reasonParts.join("; "),
    },
  };
}

export function selectRoutingAgent(
  options: { routing_mode?: RoutingMode; task_scenario?: TaskScenario; has_images?: boolean },
  profiles: RoutingProfilesConfig | undefined = undefined,
): RoutingAgentId {
  const scenario = options.has_images ? "multimodal" : options.task_scenario ?? "normal";
  if (scenario === "multimodal") return "mimo";
  return getRoutingProfiles(profiles).scenarios[scenario].current.agent_id;
}

export function validateModelForAgent(agent: AgentKind | RoutingAgentId, model: string, config?: RoutingProfilesConfig): { ok: true } | { ok: false; error: string } {
  const agentId = agentKindToRoutingAgent(agent);
  if (agentId === "mimo") {
    if (model === MIMO_ULTRA_SPEED_MODEL) {
      if (!config?.enable_mimo_pro_ultra_speed) {
        return { ok: false, error: `MiMo 不支持模型 "${model}"，Ultra Speed 未启用` };
      }
      return { ok: true };
    }
    if (!MIMO_MODELS.includes(model as typeof MIMO_MODELS[number])) {
      return { ok: false, error: `MiMo 不支持模型 "${model}"，允许的模型: ${MIMO_MODELS.join(", ")}` };
    }
    return { ok: true };
  }
  if (agentId === "reasonix-tui") {
    if (!REASONIX_MODELS.includes(model as typeof REASONIX_MODELS[number])) {
      return { ok: false, error: `Reasonix 不支持模型 "${model}"，允许的模型: ${REASONIX_MODELS.join(", ")}` };
    }
    return { ok: true };
  }
  return { ok: false, error: `当前 Agent 不支持模型路由: ${agent}` };
}

export function canAgentHandleMultimodal(agent: AgentKind | RoutingAgentId): boolean {
  return agentKindToRoutingAgent(agent) === "mimo";
}

export function isMultimodalModel(model: string): boolean {
  return model === "mimo-v2.5-flash";
}

export function reasoningEffortToMaxSteps(effort: ReasoningEffort): number {
  switch (effort) {
    case "low":
      return 10;
    case "medium":
      return 20;
    case "high":
      return 40;
  }
}

function getSelectionForAgent(
  agentId: RoutingAgentId,
  scenario: TaskScenario,
  profiles: RoutingProfilesConfig | undefined,
): RoutingSelection {
  const scenarioProfile = getRoutingProfiles(profiles).scenarios[scenario];
  if (scenarioProfile.current.agent_id === agentId) {
    return scenarioProfile.current;
  }
  const recommended = scenarioProfile.recommended[agentId];
  return { agent_id: agentId, model: recommended.model, reasoning_effort: recommended.reasoning_effort };
}

function normalizeScenarioSelection(scenario: TaskScenario, input: unknown, config?: RoutingProfilesConfig): RoutingSelection | null {
  if (!isRecord(input)) return null;
  const candidate = isRecord(input.current) ? input.current : input;
  const agentId = candidate.agent_id === "mimo" || candidate.agent_id === "reasonix-tui" ? candidate.agent_id : null;
  const model = typeof candidate.model === "string" ? candidate.model : null;
  const effort = REASONING_EFFORTS.includes(candidate.reasoning_effort as ReasoningEffort)
    ? candidate.reasoning_effort as ReasoningEffort
    : null;
  if (!agentId || !model || !effort) return null;
  if (scenario === "multimodal" && (agentId !== "mimo" || model !== "mimo-v2.5-flash")) return null;
  if (model === MIMO_ULTRA_SPEED_MODEL && !config?.enable_mimo_pro_ultra_speed) return null;
  if (!validateModelForAgent(agentId, model, config).ok) return null;
  return { agent_id: agentId, model, reasoning_effort: effort };
}

function isDisabledUltraSpeedSelection(input: unknown): boolean {
  if (!isRecord(input)) return false;
  const candidate = isRecord(input.current) ? input.current : input;
  return candidate.agent_id === "mimo" && candidate.model === MIMO_ULTRA_SPEED_MODEL;
}

function agentKindToRoutingAgent(agent: AgentKind | RoutingAgentId): RoutingAgentId | null {
  if (agent === "mimo" || agent === "reasonix-tui") {
    return agent;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
