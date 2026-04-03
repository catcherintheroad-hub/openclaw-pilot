import type { RiskLevel } from "./risk.js";

export type ProfessionalizedCommand = {
  version: string;
  original_input: string;
  normalized_intent: string;
  goal: string;
  scope: string;
  constraints: string[];
  assumptions: string[];
  deliverables: string[];
  execution_mode: "draft" | "preview" | "run";
  risk_level: RiskLevel;
  need_confirmation: boolean;
  confirmation_reason?: string;
  optimized_instruction: string;
  context_used_summary: {
    sessionKey?: string;
    channel: string;
    recentTurnsUsed: number;
    standingRulesApplied: number;
  };
  actionable_steps: Array<{
    step: string;
    intent: string;
    risk: RiskLevel;
  }>;
  execution_hints: {
    requiresAuditFirst: boolean;
    requiresPlanFirst: boolean;
    avoidActions: string[];
  };
  provenance: {
    strategyVersion: string;
    generatedAt: string;
    source: "llm" | "heuristic";
  };
};
