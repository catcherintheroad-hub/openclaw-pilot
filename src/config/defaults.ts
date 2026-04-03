import path from "node:path";
import type { CommandPilotConfig, ResolvedCommandPilotConfig, RiskPolicy } from "../domain/types.js";
import riskPolicy from "../../config/risk-policy.sample.json" with { type: "json" };

export const DEFAULT_CONFIG: ResolvedCommandPilotConfig = {
  workspacePath: process.cwd(),
  standingOrders: {
    enabled: true,
    paths: ["./AGENTS.md", "./SOUL.md", "./TOOLS.md", "./USER.md", "./MEMORY.md"],
    maxCharsPerFile: 6000,
  },
    professionalizer: {
      provider: "",
      model: "",
      authProfileId: "",
      fallbackChain: [
        {
          provider: "openai-codex",
          model: "gpt-5.4",
          authProfileId: "",
        },
      ],
      timeoutMs: 90000,
      maxTokens: 2200,
    },
  execution: {
    mode: "embedded-agent",
    timeoutMs: 120000,
    autoRunRiskLevels: ["low", "medium-low"],
  },
  riskPolicyPath: "",
  context: {
    historyTurns: 8,
    maxMessages: 24,
    cacheFileLimit: 300,
  },
};

export const DEFAULT_RISK_POLICY = riskPolicy as RiskPolicy;

export function resolvePluginConfig(raw: unknown): ResolvedCommandPilotConfig {
  const input = (raw ?? {}) as CommandPilotConfig;
  return {
    workspacePath: input.workspacePath || DEFAULT_CONFIG.workspacePath,
    standingOrders: {
      enabled: input.standingOrders?.enabled ?? DEFAULT_CONFIG.standingOrders.enabled,
      paths: input.standingOrders?.paths ?? DEFAULT_CONFIG.standingOrders.paths,
      maxCharsPerFile:
        input.standingOrders?.maxCharsPerFile ?? DEFAULT_CONFIG.standingOrders.maxCharsPerFile,
    },
    professionalizer: {
      provider: input.professionalizer?.provider ?? DEFAULT_CONFIG.professionalizer.provider,
      model: input.professionalizer?.model ?? DEFAULT_CONFIG.professionalizer.model,
      authProfileId:
        input.professionalizer?.authProfileId ?? DEFAULT_CONFIG.professionalizer.authProfileId,
      fallbackChain:
        input.professionalizer?.fallbackChain?.map((entry) => ({
          provider: entry.provider ?? "",
          model: entry.model ?? "",
          authProfileId: entry.authProfileId ?? "",
        })) ?? DEFAULT_CONFIG.professionalizer.fallbackChain,
      timeoutMs:
        input.professionalizer?.timeoutMs ?? DEFAULT_CONFIG.professionalizer.timeoutMs,
      maxTokens:
        input.professionalizer?.maxTokens ?? DEFAULT_CONFIG.professionalizer.maxTokens,
    },
    execution: {
      mode: input.execution?.mode ?? DEFAULT_CONFIG.execution.mode,
      timeoutMs: input.execution?.timeoutMs ?? DEFAULT_CONFIG.execution.timeoutMs,
      autoRunRiskLevels:
        input.execution?.autoRunRiskLevels ?? DEFAULT_CONFIG.execution.autoRunRiskLevels,
    },
    riskPolicyPath: input.riskPolicyPath ?? DEFAULT_CONFIG.riskPolicyPath,
    context: {
      historyTurns: input.context?.historyTurns ?? DEFAULT_CONFIG.context.historyTurns,
      maxMessages: input.context?.maxMessages ?? DEFAULT_CONFIG.context.maxMessages,
      cacheFileLimit: input.context?.cacheFileLimit ?? DEFAULT_CONFIG.context.cacheFileLimit,
    },
  };
}

export function resolveStandingOrderPaths(
  workspacePath: string,
  configuredPaths: string[],
): string[] {
  return configuredPaths.map((entry) =>
    path.isAbsolute(entry) ? entry : path.resolve(workspacePath, entry),
  );
}
