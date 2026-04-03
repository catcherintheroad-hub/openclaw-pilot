import { describe, expect, it } from "vitest";
import { classifyRisk, riskAllowsAutorun } from "../src/risk/risk-classifier.js";
import riskPolicyJson from "../config/risk-policy.sample.json" with { type: "json" };
import type { ProfessionalizationResult, RiskPolicy } from "../src/domain/types.js";

const riskPolicy = riskPolicyJson as unknown as RiskPolicy;

function baseResult(): ProfessionalizationResult {
  return {
    original_input: "help me",
    normalized_intent: "generic-task",
    goal: "Do work",
    scope: ["current project"],
    constraints: [],
    deliverables: [],
    execution_mode: "run",
    risk_level: "low",
    need_confirmation: false,
    optimized_instruction: "Do the work safely.",
    context_used_summary: ["recent transcript"],
    task_objective: "Do work",
    task_translation: "Translate the request into a scoped task.",
    in_scope: ["current project"],
    out_of_scope: ["unrelated areas"],
    target_files_or_areas: ["relevant workspace files"],
    execution_plan: ["inspect relevant files", "make scoped changes"],
    validation_checks: ["request satisfied"],
    workspace_hygiene: ["avoid unrelated changes"],
    stop_conditions: ["stop on ambiguous scope"],
    expected_deliverables: ["scoped result"],
    executor_prompt: "Act on the current project only, inspect the relevant files, make scoped changes, and avoid unrelated edits.",
    executor_prompt_preview: "Act on the current project only, inspect the relevant files...",
    schema_validation_ok: true,
  };
}

describe("risk classifier", () => {
  it("escalates destructive cleanup into inventory-first confirmation", () => {
    const decision = classifyRisk({
      input: "帮我把目录里没用的旧文件都清理掉",
      result: baseResult(),
      policy: riskPolicy,
    });
    expect(decision.level).toBe("medium-high");
    expect(decision.needConfirmation).toBe(true);
    expect(decision.transformedInstruction).toContain("Do not delete or overwrite anything yet.");
  });

  it("marks git push to main as high risk", () => {
    const decision = classifyRisk({
      input: "帮我把当前项目直接推到远程主分支",
      result: baseResult(),
      policy: riskPolicy,
    });
    expect(decision.level).toBe("high");
    expect(decision.needConfirmation).toBe(true);
  });

  it("respects auto-run allowlists", () => {
    expect(riskAllowsAutorun("low", ["low", "medium-low"])).toBe(true);
    expect(riskAllowsAutorun("medium-high", ["low", "medium-low"])).toBe(false);
  });
});
