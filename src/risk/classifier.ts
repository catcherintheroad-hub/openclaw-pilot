import type { RiskAssessment } from "../contracts/risk.js";
import type { RiskPolicyConfig } from "../config/schema.js";
import { normalizeRules } from "./policy.js";

const riskRank = { low: 1, medium: 2, high: 3, critical: 4 } as const;

function higherRisk(current: RiskAssessment, next: RiskAssessment): RiskAssessment {
  return riskRank[next.level] > riskRank[current.level] ? next : current;
}

export function classifyRisk(input: string, policy: RiskPolicyConfig): RiskAssessment {
  const lowered = input.toLowerCase();
  let assessment: RiskAssessment = {
    level: "low",
    action: "allow",
    needConfirmation: false,
    reasons: [],
    matchedRuleIds: []
  };

  for (const rule of normalizeRules(policy)) {
    if (rule.keywords.some((keyword) => lowered.includes(keyword))) {
      assessment = higherRisk(assessment, {
        level: rule.riskLevel,
        action: rule.defaultAction,
        needConfirmation: rule.defaultAction !== "allow",
        reasons: [...assessment.reasons, rule.description],
        matchedRuleIds: [...assessment.matchedRuleIds, rule.id]
      });
    }
  }

  return assessment;
}
