import type {
  EffectiveRiskDecision,
  ProfessionalizationResult,
  RiskLevel,
  RiskPolicy,
} from "../domain/types.js";

const RISK_ORDER: RiskLevel[] = ["low", "medium-low", "medium", "medium-high", "high"];

export function classifyRisk(params: {
  input: string;
  result: ProfessionalizationResult;
  policy: RiskPolicy;
}): EffectiveRiskDecision {
  const reasons = [...(params.result.risk_reasons ?? [])];
  let level = params.result.risk_level;
  let transformedInstruction = params.result.optimized_instruction;

  for (const rule of params.policy.blockedSilentPatterns) {
    const matcher = new RegExp(rule.match, "i");
    if (!matcher.test(params.input) && !matcher.test(params.result.optimized_instruction)) {
      continue;
    }
    level = maxRisk(level, rule.riskLevel);
    reasons.push(rule.reason);
    if (rule.action === "inventory-first") {
      transformedInstruction = [
        "Do not delete or overwrite anything yet.",
        "First inventory candidates, explain why each item appears unused, and produce a cleanup report.",
        "Only after explicit confirmation may destructive cleanup proceed.",
        "",
        params.result.optimized_instruction,
      ].join("\n");
    }
  }

  for (const hint of params.policy.destructiveHints) {
    if (params.input.toLowerCase().includes(hint.toLowerCase())) {
      level = maxRisk(level, "medium-high");
      reasons.push(`Matched destructive hint: ${hint}`);
      break;
    }
  }

  const needConfirmation = params.result.need_confirmation || compareRisk(level, "medium") >= 0;
  return {
    level,
    needConfirmation,
    reasons: dedupe(reasons),
    transformedInstruction,
  };
}

export function riskAllowsAutorun(level: RiskLevel, allowlist: RiskLevel[]): boolean {
  return allowlist.includes(level);
}

function maxRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return compareRisk(left, right) >= 0 ? left : right;
}

function compareRisk(left: RiskLevel, right: RiskLevel): number {
  return RISK_ORDER.indexOf(left) - RISK_ORDER.indexOf(right);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
