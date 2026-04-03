import type {
  EffectiveRiskDecision,
  ExecutionResult,
  GatheredContext,
  PendingApproval,
  PilotBlueprint,
  PilotCommandPacket,
  PilotFeedbackContract,
  PilotState,
  ProfessionalizationResult,
} from "../domain/types.js";
import { COMMAND_PILOT_BUILD_ID } from "../build-info.js";
import { truncate } from "../utils/text.js";

function renderLegacyPreview(params: {
  result: ProfessionalizationResult;
  risk: EffectiveRiskDecision;
  context: GatheredContext;
}): string {
  return [
    "Command Pilot Brief",
    `Build: ${COMMAND_PILOT_BUILD_ID}`,
    `Intent: ${params.result.normalized_intent}`,
    `Goal: ${params.result.goal}`,
    `Scope: ${params.result.scope.join("; ") || "(unspecified)"}`,
    `Constraints: ${params.result.constraints.join("; ") || "(none)"}`,
    `Deliverables: ${params.result.deliverables.join("; ") || "(none)"}`,
    `Risk: ${params.risk.level}`,
    `Confirmation required: ${params.risk.needConfirmation ? "yes" : "no"}`,
    `Context used: ${params.result.context_used_summary.join("; ") || "(none)"}`,
    `Executor prompt preview: ${params.result.executor_prompt_preview || truncate(params.result.executor_prompt, 320)}`,
    "",
    "Optimized instruction:",
    params.risk.transformedInstruction ?? params.result.optimized_instruction,
  ].join("\n");
}

function buildBlueprint(params: {
  result: ProfessionalizationResult;
  risk: EffectiveRiskDecision;
}): PilotBlueprint {
  const pilotId = `pilot-${truncate(params.result.original_input || params.result.normalized_intent || "idea", 24).replace(/\s+/g, "-").toLowerCase()}`;
  return {
    pilot_id: pilotId,
    project_goal: params.result.goal,
    core_thesis: params.result.normalized_intent,
    current_stage: {
      stage_id: `stage-${truncate(params.result.task_objective || params.result.goal, 24).replace(/\s+/g, "-").toLowerCase()}`,
      stage_name: params.result.execution_mode === "run" ? "Auto-run stage" : "Blueprint stage",
      stage_objective: params.result.task_translation || params.result.goal,
      why_this_stage_now: params.result.execution_mode === "run" ? "Auto-run was explicitly requested." : "Compile a blueprint before execution.",
      in_scope_now: params.result.in_scope.length > 0 ? params.result.in_scope : params.result.scope,
      out_of_scope_now: params.result.out_of_scope.length > 0 ? params.result.out_of_scope : ["unrelated work"],
      success_criteria: params.result.validation_checks.length > 0 ? params.result.validation_checks : ["The stage objective is ready to hand to OpenClaw."],
      key_risks: params.risk.reasons.length > 0 ? params.risk.reasons : ["No additional risks surfaced by the current pass."],
      constraints: params.result.constraints.length > 0 ? params.result.constraints : ["Keep scope tight."],
    },
    run_mode: params.result.run_mode ?? (params.result.execution_mode === "run" ? "auto_run" : "plan_only"),
  };
}

function buildCommandPacket(params: {
  result: ProfessionalizationResult;
  context: GatheredContext;
  blueprint: PilotBlueprint;
}): PilotCommandPacket {
  const stage = params.blueprint.current_stage;
  return {
    packet_version: "v1",
    pilot_id: params.blueprint.pilot_id,
    project: params.blueprint.project_goal,
    stage: stage.stage_name,
    stage_objective: stage.stage_objective,
    why_this_stage_now: stage.why_this_stage_now,
    known_context: [
      params.context.snapshot?.channel ? `channel: ${params.context.snapshot.channel}` : "channel: unknown",
      params.context.snapshot?.conversationId ? `conversation: ${params.context.snapshot.conversationId}` : "conversation: unknown",
      ...(params.result.context_used_summary.length > 0 ? params.result.context_used_summary.map((entry) => `context: ${entry}`) : ["context: none"]),
    ],
    in_scope: stage.in_scope_now,
    out_of_scope: stage.out_of_scope_now,
    constraints: stage.constraints,
    execution_plan: params.result.execution_plan.length > 0 ? params.result.execution_plan : ["Audit first", "Compile packet", "Wait for feedback"],
    deliverables: params.result.expected_deliverables.length > 0 ? params.result.expected_deliverables : ["Blueprint", "Ready-to-send OpenClaw command", "Feedback contract"],
    validation: stage.success_criteria,
    stop_conditions: params.result.stop_conditions.length > 0 ? params.result.stop_conditions : ["Stop when context is insufficient."],
    do_not: params.result.workspace_hygiene.length > 0 ? params.result.workspace_hygiene : ["Do not expand scope."],
    return_format: [
      "STATUS: done | blocked | needs_input | failed",
      "SUMMARY:",
      "WHAT_WAS_DONE:",
      "ARTIFACTS:",
      "FILES_CHANGED:",
      "VALIDATION_RESULT:",
      "BLOCKERS:",
      "NEXT_STEP_SUGGESTION:",
    ],
  };
}

function buildFeedbackContract(blueprint: PilotBlueprint): PilotFeedbackContract {
  return {
    what_to_send_back: [
      `pilot_id: ${blueprint.pilot_id}`,
      `current_stage_id: ${blueprint.current_stage.stage_id}`,
      "latest_feedback_summary: <summary of OpenClaw result or blocker>",
    ],
    if_blocked: [
      "If OpenClaw is blocked, return the exact blocker, the stage that was blocked, and the missing input or permission.",
      "If the stage completes, return the concrete result, changed files or artifacts, and any follow-up recommendation.",
    ],
    next_command_template: `/pilot next ${blueprint.pilot_id} + <OpenClaw feedback>`,
  };
}

function renderBlueprint(state: PilotState): string {
  const blueprint = state.project_blueprint;
  const stage = blueprint.current_stage;
  return [
    "A. Command Pilot Blueprint",
    `Pilot ID: ${state.pilot_id}`,
    `Project Goal: ${state.project_goal}`,
    `Core Thesis: ${state.core_thesis}`,
    `Current Stage: ${stage.stage_name}`,
    `Why this stage now: ${stage.why_this_stage_now}`,
    `In scope now: ${stage.in_scope_now.join("; ") || "(none)"}`,
    `Out of scope now: ${stage.out_of_scope_now.join("; ") || "(none)"}`,
    `Success criteria: ${stage.success_criteria.join("; ") || "(none)"}`,
    `Key risks: ${stage.key_risks.join("; ") || "(none)"}`,
    `Run mode: ${state.run_mode}`,
    `Confirmation required: ${state.confirmation_required ? "yes" : "no"}`,
    `Latest feedback summary: ${state.latest_feedback_summary || "(none)"}`,
  ].join("\n");
}

function renderReadyCommand(state: PilotState, packet: PilotCommandPacket): string {
  return [
    "B. Ready-to-send OpenClaw Command",
    "",
    "[OPENCLAW_EXECUTION_PACKET v1]",
    "",
    "ROLE:",
    "你是 OpenClaw 执行代理。你的职责是只完成当前阶段目标，不擅自扩展到下一阶段。",
    "",
    "PROJECT:",
    packet.project,
    "",
    "STAGE:",
    packet.stage,
    "",
    "STAGE_OBJECTIVE:",
    packet.stage_objective,
    "",
    "WHY_THIS_STAGE_NOW:",
    packet.why_this_stage_now,
    "",
    "KNOWN_CONTEXT:",
    ...packet.known_context.map((entry) => `- ${entry}`),
    "",
    "IN_SCOPE:",
    ...packet.in_scope.map((entry) => `- ${entry}`),
    "",
    "OUT_OF_SCOPE:",
    ...packet.out_of_scope.map((entry) => `- ${entry}`),
    "",
    "CONSTRAINTS:",
    ...packet.constraints.map((entry) => `- ${entry}`),
    "",
    "EXECUTION_PLAN:",
    ...packet.execution_plan.map((entry, index) => `${index + 1}. ${entry}`),
    "",
    "DELIVERABLES:",
    ...packet.deliverables.map((entry) => `- ${entry}`),
    "",
    "VALIDATION:",
    ...packet.validation.map((entry) => `- ${entry}`),
    "",
    "STOP_CONDITIONS:",
    ...packet.stop_conditions.map((entry) => `- ${entry}`),
    "",
    "DO_NOT:",
    ...packet.do_not.map((entry) => `- ${entry}`),
    "",
    "RETURN_FORMAT:",
    ...packet.return_format.map((entry) => `- ${entry}`),
    "",
    "[END_OPENCLAW_EXECUTION_PACKET]",
    "",
    `Pilot ID: ${state.pilot_id}`,
    `Run mode: ${state.run_mode}`,
  ].join("\n");
}

function renderFeedbackContract(contract: PilotFeedbackContract): string {
  return [
    "C. What to send back",
    ...contract.what_to_send_back.map((entry) => `- ${entry}`),
    "",
    ...contract.if_blocked.map((entry) => `- ${entry}`),
    "",
    `D. Next command: ${contract.next_command_template}`,
  ].join("\n");
}

export function renderPlanResponse(params: {
  state: PilotState;
  packet: PilotCommandPacket;
  feedbackContract: PilotFeedbackContract;
}): string {
  return [renderBlueprint(params.state), "", renderReadyCommand(params.state, params.packet), "", renderFeedbackContract(params.feedbackContract)].join("\n");
}

export function renderStatus(state: PilotState): string {
  return [
    renderBlueprint(state),
    "",
    "C. What to send back",
    `- Summary: ${state.latest_feedback_summary || "(none)"}`,
    `- Stage feedback history entries: ${state.execution_feedback_history.length}`,
    "",
    `D. Next command: /pilot next ${state.pilot_id}`,
  ].join("\n");
}

export function renderNextCommand(state: PilotState): string {
  return `D. Next command: /pilot next ${state.pilot_id}`;
}

export function renderPreview(params: {
  result: ProfessionalizationResult;
  risk: EffectiveRiskDecision;
  context: GatheredContext;
}): string {
  return renderLegacyPreview(params);
}

export function renderApprovalNeeded(approval: PendingApproval): string {
  return [
    renderLegacyPreview({
      result: approval.result,
      risk: approval.risk,
      context: {
        snapshot: approval.context,
        standingOrders: [],
        channelSummary: [],
      },
    }),
    "",
    `Pending approval id: ${approval.id}`,
    `Confirm with: /pilot confirm ${approval.id}`,
    `Discard with: /pilot discard ${approval.id}`,
  ].join("\n");
}

export function renderContinueNeeded(approval: PendingApproval): string {
  return [
    renderLegacyPreview({
      result: approval.result,
      risk: approval.risk,
      context: {
        snapshot: approval.context,
        standingOrders: [],
        channelSummary: [],
      },
    }),
    "",
    `NEXT_CMD: /pilot 继续 ${approval.id}`,
    `Continue with: /pilot continue ${approval.id}`,
    `Or rerun explicitly with: /pilot --run ${approval.request.rawInput}`,
    `Discard with: /pilot discard ${approval.id}`,
  ].join("\n");
}

export function renderExecutionResult(result: ExecutionResult): string {
  return [
    `Execution status: ${result.status}`,
    result.handoffPromptSource ? `Handoff prompt source: ${result.handoffPromptSource}` : "",
    result.gateDecision ? `Gate decision: ${result.gateDecision}` : "",
    "",
    result.summary,
  ].join("\n");
}
