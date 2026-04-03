export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RiskAction = "allow" | "confirm" | "block";

export type RiskRule = {
  id: string;
  description: string;
  riskLevel: RiskLevel;
  defaultAction: RiskAction;
  keywords: string[];
};

export type RiskAssessment = {
  level: RiskLevel;
  action: RiskAction;
  needConfirmation: boolean;
  reasons: string[];
  matchedRuleIds: string[];
};
