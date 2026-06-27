export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface TokenUsageRecordOptions {
  totalTokens?: number;
  estimatedCost?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  agent?: string;
  model?: string;
}

export interface TokenBudgetConfig {
  max_input_tokens: number;
  max_output_tokens: number;
  max_total_tokens: number;
  max_cost: number;
  warning_threshold: number;
}

export interface TokenBudgetStatus {
  used: TokenUsage;
  budget: TokenBudgetConfig;
  remaining: TokenUsage;
  utilization: {
    input_percent: number;
    output_percent: number;
    total_percent: number;
    cost_percent: number;
  };
  warnings: string[];
  exceeded: boolean;
}

export interface TokenUsageAnalytics {
  by_agent: Record<string, TokenUsage>;
  by_model: Record<string, TokenUsage>;
  time_ranges_by_model: Record<"1h" | "24h" | "7d" | "30d" | "all", Record<string, TokenUsage>>;
  time_ranges: Record<"1h" | "24h" | "7d" | "30d" | "all", TokenUsage>;
  history_count: number;
}

const DEFAULT_BUDGET: TokenBudgetConfig = {
  max_input_tokens: 100000,
  max_output_tokens: 50000,
  max_total_tokens: 150000,
  max_cost: 1.0,
  warning_threshold: 0.8,
};

export class TokenBudgetManager {
  private budget: TokenBudgetConfig;
  private usage: TokenUsage;
  private history: Array<{ timestamp: number; usage: TokenUsage; context: string; agent: string; model: string }>;

  constructor(budget: Partial<TokenBudgetConfig> = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.usage = emptyUsage();
    this.history = [];
  }

  getBudget(): TokenBudgetConfig {
    return { ...this.budget };
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  getHistory(): Array<{ timestamp: number; usage: TokenUsage; context: string; agent: string; model: string }> {
    return [...this.history];
  }

  recordUsage(
    inputTokens: number,
    outputTokens: number,
    context: string = "",
    options: TokenUsageRecordOptions = {}
  ): TokenBudgetStatus {
    const safeInputTokens = Math.max(0, Math.floor(inputTokens));
    const safeOutputTokens = Math.max(0, Math.floor(outputTokens));
    const totalTokens = Math.max(0, Math.floor(options.totalTokens ?? safeInputTokens + safeOutputTokens));
    const cacheReadTokens = Math.max(0, Math.floor(options.cacheReadTokens ?? 0));
    const cacheWriteTokens = Math.max(0, Math.floor(options.cacheWriteTokens ?? 0));
    const agent = options.agent?.trim() || inferAgentFromContext(context);
    const model = options.model?.trim() || inferModelFromContext(context, agent);
    const cost = typeof options.estimatedCost === "number"
      ? Math.max(0, options.estimatedCost)
      : this.estimateCost(safeInputTokens, safeOutputTokens);

    this.usage.input_tokens += safeInputTokens;
    this.usage.output_tokens += safeOutputTokens;
    this.usage.total_tokens += totalTokens;
    this.usage.estimated_cost += cost;
    this.usage.cache_read_tokens += cacheReadTokens;
    this.usage.cache_write_tokens += cacheWriteTokens;

    const usage = {
      input_tokens: safeInputTokens,
      output_tokens: safeOutputTokens,
      total_tokens: totalTokens,
      estimated_cost: cost,
      cache_read_tokens: cacheReadTokens,
      cache_write_tokens: cacheWriteTokens,
    };
    this.history.push({
      timestamp: Date.now(),
      usage,
      context,
      agent,
      model,
    });

    return this.getStatus();
  }

  getAnalytics(now: number = Date.now()): TokenUsageAnalytics {
    const ranges = {
      "1h": 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    const by_agent: Record<string, TokenUsage> = {};
    const by_model: Record<string, TokenUsage> = {};
    const time_ranges: TokenUsageAnalytics["time_ranges"] = {
      "1h": emptyUsage(),
      "24h": emptyUsage(),
      "7d": emptyUsage(),
      "30d": emptyUsage(),
      all: emptyUsage(),
    };
    const time_ranges_by_model: TokenUsageAnalytics["time_ranges_by_model"] = {
      "1h": {},
      "24h": {},
      "7d": {},
      "30d": {},
      all: {},
    };

    for (const record of this.history) {
      addUsage(by_agent[record.agent] ??= emptyUsage(), record.usage);
      addUsage(by_model[record.model] ??= emptyUsage(), record.usage);
      addUsage(time_ranges.all, record.usage);
      addUsage(time_ranges_by_model.all[record.model] ??= emptyUsage(), record.usage);
      for (const [key, windowMs] of Object.entries(ranges) as Array<[keyof typeof ranges, number]>) {
        if (now - record.timestamp <= windowMs) {
          addUsage(time_ranges[key], record.usage);
          addUsage(time_ranges_by_model[key][record.model] ??= emptyUsage(), record.usage);
        }
      }
    }

    return { by_agent, by_model, time_ranges_by_model, time_ranges, history_count: this.history.length };
  }

  getStatus(): TokenBudgetStatus {
    const remaining: TokenUsage = {
      input_tokens: Math.max(0, this.budget.max_input_tokens - this.usage.input_tokens),
      output_tokens: Math.max(0, this.budget.max_output_tokens - this.usage.output_tokens),
      total_tokens: Math.max(0, this.budget.max_total_tokens - this.usage.total_tokens),
      estimated_cost: Math.max(0, this.budget.max_cost - this.usage.estimated_cost),
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    };

    const utilization = {
      input_percent: (this.usage.input_tokens / this.budget.max_input_tokens) * 100,
      output_percent: (this.usage.output_tokens / this.budget.max_output_tokens) * 100,
      total_percent: (this.usage.total_tokens / this.budget.max_total_tokens) * 100,
      cost_percent: (this.usage.estimated_cost / this.budget.max_cost) * 100,
    };

    const warnings: string[] = [];
    if (utilization.input_percent >= this.budget.warning_threshold * 100) {
      warnings.push(`输入 token 使用率已达 ${utilization.input_percent.toFixed(1)}%`);
    }
    if (utilization.output_percent >= this.budget.warning_threshold * 100) {
      warnings.push(`输出 token 使用率已达 ${utilization.output_percent.toFixed(1)}%`);
    }
    if (utilization.total_percent >= this.budget.warning_threshold * 100) {
      warnings.push(`总 token 使用率已达 ${utilization.total_percent.toFixed(1)}%`);
    }
    if (utilization.cost_percent >= this.budget.warning_threshold * 100) {
      warnings.push(`成本使用率已达 ${utilization.cost_percent.toFixed(1)}%`);
    }

    const exceeded = this.usage.total_tokens >= this.budget.max_total_tokens ||
                     this.usage.estimated_cost >= this.budget.max_cost;

    return {
      used: { ...this.usage },
      budget: { ...this.budget },
      remaining,
      utilization,
      warnings,
      exceeded,
    };
  }

  reset(): void {
    this.usage = emptyUsage();
    this.history = [];
  }

  updateBudget(budget: Partial<TokenBudgetConfig>): void {
    this.budget = { ...this.budget, ...budget };
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    const inputCostPer1k = 0.0015;
    const outputCostPer1k = 0.002;
    return (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
  }

  generateReport(): string {
    const status = this.getStatus();
    const lines = [
      "# Token Budget Report",
      "",
      "## 当前使用情况",
      `- 输入 tokens: ${status.used.input_tokens.toLocaleString()} / ${status.budget.max_input_tokens.toLocaleString()} (${status.utilization.input_percent.toFixed(1)}%)`,
      `- 输出 tokens: ${status.used.output_tokens.toLocaleString()} / ${status.budget.max_output_tokens.toLocaleString()} (${status.utilization.output_percent.toFixed(1)}%)`,
      `- 缓存读取 tokens: ${status.used.cache_read_tokens.toLocaleString()}`,
      `- 缓存写入 tokens: ${status.used.cache_write_tokens.toLocaleString()}`,
      `- 总 tokens: ${status.used.total_tokens.toLocaleString()} / ${status.budget.max_total_tokens.toLocaleString()} (${status.utilization.total_percent.toFixed(1)}%)`,
      `- 预估成本: ¥${status.used.estimated_cost.toFixed(4)} / ¥${status.budget.max_cost.toFixed(2)} (${status.utilization.cost_percent.toFixed(1)}%)`,
      "",
      "## 剩余配额",
      `- 输入 tokens: ${status.remaining.input_tokens.toLocaleString()}`,
      `- 输出 tokens: ${status.remaining.output_tokens.toLocaleString()}`,
      `- 总 tokens: ${status.remaining.total_tokens.toLocaleString()}`,
      `- 预估成本: ¥${status.remaining.estimated_cost.toFixed(4)}`,
      "",
    ];

    if (status.warnings.length > 0) {
      lines.push("## 警告");
      for (const warning of status.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push("");
    }

    if (status.exceeded) {
      lines.push("## 状态: 已超限");
    } else {
      lines.push("## 状态: 正常");
    }

    return lines.join("\n");
  }
}

export const globalTokenBudget = new TokenBudgetManager();

function emptyUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_cost: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
}

function addUsage(target: TokenUsage, usage: TokenUsage): void {
  target.input_tokens += usage.input_tokens;
  target.output_tokens += usage.output_tokens;
  target.total_tokens += usage.total_tokens;
  target.estimated_cost += usage.estimated_cost;
  target.cache_read_tokens += usage.cache_read_tokens;
  target.cache_write_tokens += usage.cache_write_tokens;
}

function inferAgentFromContext(context: string): string {
  const lowered = context.toLowerCase();
  if (lowered.includes("reasonix")) return "reasonix-tui";
  if (lowered.includes("mimo")) return "mimo";
  return "unknown";
}

function inferModelFromContext(context: string, agent: string): string {
  const lowered = context.toLowerCase();
  const knownModels = [
    "mimo-v2.5-pro-ultraspeed",
    "mimo-v2.5-flash",
    "mimo-v2.5-pro",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
  ];
  for (const model of knownModels) {
    if (lowered.includes(model)) return model;
  }
  return `${agent || "unknown"}:unknown`;
}
