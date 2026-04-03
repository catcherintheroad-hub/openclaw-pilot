import type { ProfessionalizedCommand } from "../contracts/professionalizer.js";
import type { RiskAssessment } from "../contracts/risk.js";

export function renderPreview(result: ProfessionalizedCommand, risk: RiskAssessment): string {
  const steps = result.actionable_steps.map((step, index) => `${index + 1}. ${step.step}`).join("\n");
  return [
    `Command Pilot Brief`,
    ``,
    `Intent: ${result.normalized_intent}`,
    `Goal: ${result.goal}`,
    `Scope: ${result.scope}`,
    `Risk: ${risk.level}`,
    `Need confirmation: ${risk.needConfirmation ? "yes" : "no"}`,
    result.constraints.length ? `Constraints: ${result.constraints.join("; ")}` : "",
    ``,
    `Optimized instruction:`,
    result.optimized_instruction,
    ``,
    `Planned steps:`,
    steps
  ]
    .filter(Boolean)
    .join("\n");
}
