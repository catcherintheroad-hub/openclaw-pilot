import type { RiskPolicyConfig } from "../config/schema.js";
import type { RiskRule } from "../contracts/risk.js";

export function normalizeRules(config: RiskPolicyConfig): RiskRule[] {
  return config.rules.map((rule) => ({
    id: rule.id,
    description: rule.description,
    riskLevel: rule.riskLevel,
    defaultAction: rule.defaultAction,
    keywords: rule.keywords.map((keyword) => keyword.toLowerCase())
  }));
}
