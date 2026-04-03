import type { PilotPluginConfig } from "../config/schema.js";
import type { RiskAssessment, RiskLevel } from "../contracts/risk.js";

const order: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export function canAutoRun(risk: RiskAssessment, config: PilotPluginConfig): boolean {
  return risk.action === "allow" && order[risk.level] <= order[config.allowAutoRunUpTo];
}
