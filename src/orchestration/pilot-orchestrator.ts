import path from "node:path";
import type { OpenClawPluginApi, PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";
import { resolvePluginConfig, resolveStandingOrderPaths } from "../config/defaults.js";
import { loadRiskPolicy } from "../config/load-risk-policy.js";
import { gatherContext } from "../context/context-gatherer.js";
import { executeOptimizedInstruction } from "../execution/embedded-agent-handoff.js";
import { assessExecutionGuards } from "../execution/runtime-guards.js";
import type {
  CommandPilotConfig,
  EffectiveRiskDecision,
  PendingApproval,
  PilotBlueprint,
  PilotBlueprintStage,
  PilotCommandPacket,
  PilotContextSnapshot,
  PilotFeedbackContract,
  PilotFeedbackEntry,
  PilotRequest,
  PilotRunMode,
  PilotState,
  ProfessionalizationResult,
} from "../domain/types.js";
import { classifyRisk, riskAllowsAutorun } from "../risk/risk-classifier.js";
import { shortHash } from "../utils/hash.js";
import { detectPilotOutputLanguage, isChinesePilotOutput } from "../utils/language.js";
import { normalizeWhitespace, truncate } from "../utils/text.js";
import { professionalizeWithLlm } from "../professionalizer/structured-llm.js";
import { PendingApprovalsStore } from "./pending-approvals.js";
import { parsePilotCommand } from "./command-parser.js";
import {
  renderApprovalNeeded,
  renderContinueNeeded,
  renderExecutionResult,
  renderNextCommand,
  renderPlanResponse,
  renderPlanResponseParts,
  renderStatus,
} from "./response-renderer.js";
import { ConversationCache } from "../context/conversation-cache.js";
import { PilotStateStore } from "./pilot-state-store.js";

export type PilotRuntimeServices = {
  cache: ConversationCache;
  approvals: PendingApprovalsStore;
  states: PilotStateStore;
};

function shouldLogLocaleTrace(): boolean {
  return (globalThis as { __OPENCLAW_COMMAND_PILOT_DEBUG_LOCALE__?: boolean }).__OPENCLAW_COMMAND_PILOT_DEBUG_LOCALE__ === true;
}

export async function handlePilotCommand(params: {
  api: OpenClawPluginApi;
  ctx: PluginCommandContext;
  pluginConfig: CommandPilotConfig | undefined;
  services: PilotRuntimeServices;
}) {
  const request = parsePilotCommand(params.ctx.args);
  const ctxWithSession = params.ctx as PluginCommandContext & { sessionKey?: string; sessionId?: string };
  params.api.logger.info(
    `command-pilot: handler start action=${request.action} run_mode=${request.runMode ?? "plan_only"} session=${ctxWithSession.sessionKey ?? ctxWithSession.sessionId ?? "unknown"}`,
  );

  if (request.action === "status") {
    return await statusPilot(params, request);
  }
  if (request.action === "next") {
    return await advancePilot(params, request);
  }
  if (request.action === "confirm") {
    return await confirmPending(params, request);
  }
  if (request.action === "continue") {
    return await continuePending(params, request);
  }
  if (request.action === "discard") {
    return await discardPending(params, request);
  }
  if (!request.rawInput) {
    return {
      text: "Usage: /pilot <idea> | /pilot --run <idea> | /pilot next <pilot-id> [feedback] | /pilot status <pilot-id> | /pilot discard <pilot-id>",
    };
  }

  const config = resolvePluginConfig(params.pluginConfig);
  const lookup = buildLookupFromCommand(params.ctx);
  const standingOrderPaths = resolveStandingOrderPaths(config.workspacePath, config.standingOrders.paths);
  const gatheredContext = await gatherContext({
    cache: params.services.cache,
    workspacePath: config.workspacePath,
    standingOrdersEnabled: config.standingOrders.enabled,
    standingOrderPaths,
    standingOrdersMaxChars: config.standingOrders.maxCharsPerFile,
    lookup,
  });
  const riskPolicy = await loadRiskPolicy(config.riskPolicyPath, config.workspacePath);
  const result = await professionalizeWithLlm({
    api: params.api,
    config,
    input: request.rawInput,
    mode: toProfessionalizerMode(request.runMode ?? "plan_only"),
    context: gatheredContext,
  });
  params.api.logger.info(
    `command-pilot: professionalizer complete run_mode=${request.runMode ?? "plan_only"} pilot_input_chars=${request.rawInput.length}`,
  );
  if (shouldLogLocaleTrace()) {
    params.api.logger.info(
      `command-pilot: locale trace detected=${detectPilotOutputLanguage(request.rawInput)} professionalizer=${result.output_language ?? "unset"} input_preview=${JSON.stringify(truncate(request.rawInput, 48))}`,
    );
  }

  let risk = classifyRisk({
    input: request.rawInput,
    result,
    policy: riskPolicy,
  });

  const startedAt = Date.now();
  const state = buildPilotState({
    request,
    result,
    risk,
    context: gatheredContext,
    runMode: request.runMode ?? "plan_only",
    startedAt,
    snapshot: gatheredContext.snapshot,
  });
  if (shouldLogLocaleTrace()) {
    params.api.logger.info(
      `command-pilot: locale trace state_output=${state.output_language} pilot_id=${state.pilot_id} stage=${JSON.stringify(state.current_stage_name)}`,
    );
  }
  await params.services.states.save(state);
  params.api.logger.info(`command-pilot: state saved pilot_id=${state.pilot_id} status=${state.status}`);

  const preview = renderPlanResponse({
    state,
    packet: stateToPacket(state),
    feedbackContract: buildFeedbackContract(state),
  });
  const splitPreview = renderPlanResponseParts({
    state,
    packet: stateToPacket(state),
    feedbackContract: buildFeedbackContract(state),
  });

  if ((request.runMode ?? "plan_only") === "plan_only") {
    params.api.logger.info(`command-pilot: plan_only return pilot_id=${state.pilot_id}`);
    return {
      text: splitPreview.combinedText,
      messages: splitPreview.messages,
    };
  }

  const guardAssessment = await assessExecutionGuards({
    workspacePath: config.workspacePath,
    input: request.rawInput,
    risk,
    result,
  });
  params.api.logger.info(
    `command-pilot: auto_run guards complete pilot_id=${state.pilot_id} risk=${guardAssessment.risk.level} confirmation=${guardAssessment.risk.needConfirmation ? "yes" : "no"}`,
  );
  risk = guardAssessment.risk;

  if (risk.needConfirmation || !riskAllowsAutorun(risk.level, config.execution.autoRunRiskLevels)) {
    const approval = buildPendingApproval(request, result, risk, gatheredContext.snapshot, params.ctx, state.pilot_id);
    await params.services.approvals.save(approval);
    await params.services.states.save({
      ...state,
      risk_level: risk.level,
      confirmation_required: true,
      status: "blocked",
      updated_at: Date.now(),
      next_step_rationale: renderRiskRationale(risk),
    });
    return {
      text: renderApprovalNeeded(approval),
    };
  }

  params.api.logger.info(`command-pilot: auto_run execution start pilot_id=${state.pilot_id}`);
  const execution = await executeOptimizedInstruction({
    api: params.api,
    config,
    result: {
      ...result,
      optimized_instruction: risk.transformedInstruction ?? result.optimized_instruction,
    },
    contextSummary: result.context_used_summary,
    originalInput: request.rawInput,
    allowMutatingGit: guardAssessment.isGitTask,
    repoHasAutopushHook: guardAssessment.repoHasAutopushHook,
  });

  await params.services.states.save({
    ...state,
    risk_level: risk.level,
    confirmation_required: risk.needConfirmation,
    status: execution.status === "completed" ? "completed" : "blocked",
    updated_at: Date.now(),
    latest_feedback_summary: summarizeText(execution.summary),
    next_step_rationale:
      execution.status === "completed"
        ? "Wait for OpenClaw feedback or call /pilot next."
        : "Review the execution blockers before advancing.",
    execution_feedback_history: appendFeedback(state.execution_feedback_history, {
      received_at: Date.now(),
      source: "openclaw",
      raw_feedback: execution.summary,
      summary: summarizeText(execution.summary),
      pilot_stage_id: state.current_stage_id,
    }),
    latest_result: result,
  });

  const executionText = renderExecutionResult(execution, state.output_language);
  const splitAutoRun = renderPlanResponseParts({
    state,
    packet: stateToPacket(state),
    feedbackContract: buildFeedbackContract(state),
    executionText,
  });

  return {
    text: [preview, "", executionText].join("\n\n"),
    messages: splitAutoRun.messages,
  };
}

function buildPendingApproval(
  request: PilotRequest,
  result: ProfessionalizationResult,
  risk: EffectiveRiskDecision,
  snapshot: PilotContextSnapshot | undefined,
  ctx: PluginCommandContext,
  pilotId: string,
): PendingApproval {
  const createdAt = Date.now();
  return {
    id: pilotId,
    pilotId,
    createdAt,
    expiresAt: createdAt + 24 * 60 * 60 * 1000,
    request,
    context:
      snapshot ??
      {
        channel: ctx.channel,
        accountId: ctx.accountId,
        senderId: ctx.senderId,
        rawFrom: ctx.from,
        rawTo: ctx.to,
        messageThreadId: ctx.messageThreadId,
        recentMessages: [],
        updatedAt: createdAt,
      },
    result: {
      ...result,
      optimized_instruction: risk.transformedInstruction ?? result.optimized_instruction,
    },
    risk,
  };
}

async function confirmPending(
  params: {
    api: OpenClawPluginApi;
    ctx: PluginCommandContext;
    pluginConfig: CommandPilotConfig | undefined;
    services: PilotRuntimeServices;
  },
  request: PilotRequest,
) {
  if (!request.approvalId) {
    return { text: "Missing approval id. Usage: /pilot confirm <approval-id>" };
  }
  const pending = await params.services.approvals.consume(request.approvalId);
  if (!pending) {
    return { text: `Approval ${request.approvalId} was not found or expired.` };
  }
  const config = resolvePluginConfig(params.pluginConfig);
  const guardAssessment = await assessExecutionGuards({
    workspacePath: config.workspacePath,
    input: pending.request.rawInput,
    risk: pending.risk,
    result: pending.result,
  });
  const execution = await executeOptimizedInstruction({
    api: params.api,
    config,
    result: pending.result,
    contextSummary: pending.result.context_used_summary,
    originalInput: pending.request.rawInput,
    allowMutatingGit: guardAssessment.isGitTask,
    repoHasAutopushHook: guardAssessment.repoHasAutopushHook,
  });
  await params.services.states.update(request.approvalId, (state) => ({
    ...state,
    status: execution.status === "completed" ? "completed" : "blocked",
    updated_at: Date.now(),
    latest_feedback_summary: summarizeText(execution.summary),
    execution_feedback_history: appendFeedback(state.execution_feedback_history, {
      received_at: Date.now(),
      source: "openclaw",
      raw_feedback: execution.summary,
      summary: summarizeText(execution.summary),
      pilot_stage_id: state.current_stage_id,
    }),
  }));
  return {
    text: [renderApprovalNeeded(pending), "", renderExecutionResult(execution)].join("\n\n"),
  };
}

async function discardPending(
  params: {
    api: OpenClawPluginApi;
    ctx: PluginCommandContext;
    pluginConfig: CommandPilotConfig | undefined;
    services: PilotRuntimeServices;
  },
  request: PilotRequest,
) {
  const pilotId = request.approvalId ?? request.pilotId;
  if (!pilotId) {
    return { text: "Missing pilot id. Usage: /pilot discard <pilot-id>" };
  }
  const discarded = await params.services.states.discard(pilotId);
  const removedApproval = await params.services.approvals.discard(pilotId);
  return {
    text:
      discarded || removedApproval
        ? `Discarded pilot ${pilotId}.`
        : `Pilot ${pilotId} was not found or already expired.`,
  };
}

async function continuePending(
  params: {
    api: OpenClawPluginApi;
    ctx: PluginCommandContext;
    pluginConfig: CommandPilotConfig | undefined;
    services: PilotRuntimeServices;
  },
  request: PilotRequest,
) {
  if (!request.approvalId) {
    return { text: "Missing approval id. Usage: /pilot continue <approval-id>" };
  }
  const pending = await params.services.approvals.get(request.approvalId);
  if (!pending) {
    return { text: `Approval ${request.approvalId} was not found or expired.` };
  }
  if (pending.risk.needConfirmation) {
    return {
      text: [
        renderApprovalNeeded(pending),
        "",
        `This request is high-risk. Confirm with: /pilot confirm ${pending.id}`,
      ].join("\n"),
    };
  }

  await params.services.approvals.consume(request.approvalId);
  const config = resolvePluginConfig(params.pluginConfig);
  const guardAssessment = await assessExecutionGuards({
    workspacePath: config.workspacePath,
    input: pending.request.rawInput,
    risk: pending.risk,
    result: pending.result,
  });
  if (guardAssessment.risk.needConfirmation && !pending.risk.needConfirmation) {
    const updatedPending = {
      ...pending,
      risk: guardAssessment.risk,
      result: {
        ...pending.result,
        optimized_instruction: guardAssessment.risk.transformedInstruction ?? pending.result.optimized_instruction,
      },
    };
    await params.services.approvals.save(updatedPending);
    return {
      text: renderApprovalNeeded(updatedPending),
    };
  }
  const execution = await executeOptimizedInstruction({
    api: params.api,
    config,
    result: pending.result,
    contextSummary: pending.result.context_used_summary,
    originalInput: pending.request.rawInput,
    allowMutatingGit: guardAssessment.isGitTask,
    repoHasAutopushHook: guardAssessment.repoHasAutopushHook,
  });
  await params.services.states.update(request.approvalId, (state) => ({
    ...state,
    status: execution.status === "completed" ? "completed" : "blocked",
    updated_at: Date.now(),
    latest_feedback_summary: summarizeText(execution.summary),
    execution_feedback_history: appendFeedback(state.execution_feedback_history, {
      received_at: Date.now(),
      source: "openclaw",
      raw_feedback: execution.summary,
      summary: summarizeText(execution.summary),
      pilot_stage_id: state.current_stage_id,
    }),
  }));
  return {
    text: [renderContinueNeeded(pending), "", renderExecutionResult(execution)].join("\n\n"),
  };
}

async function statusPilot(
  params: {
    api: OpenClawPluginApi;
    ctx: PluginCommandContext;
    pluginConfig: CommandPilotConfig | undefined;
    services: PilotRuntimeServices;
  },
  request: PilotRequest,
) {
  const pilotId = resolvePilotId(request);
  if (!pilotId) {
    return { text: "Missing pilot id. Usage: /pilot status <pilot-id>" };
  }
  const state = await params.services.states.get(pilotId);
  if (!state) {
    return { text: `Pilot ${pilotId} was not found.` };
  }
  return { text: renderStatus(state) };
}

async function advancePilot(
  params: {
    api: OpenClawPluginApi;
    ctx: PluginCommandContext;
    pluginConfig: CommandPilotConfig | undefined;
    services: PilotRuntimeServices;
  },
  request: PilotRequest,
) {
  const pilotId = resolvePilotId(request);
  if (!pilotId) {
    return { text: "Missing pilot id. Usage: /pilot next <pilot-id> [feedback]" };
  }
  const existing = await params.services.states.get(pilotId);
  if (!existing) {
    return { text: `Pilot ${pilotId} was not found.` };
  }

  const feedbackSummary = summarizeText(request.feedback ?? request.rawInput ?? "");
  const nextStage = buildNextStage(existing, feedbackSummary);
  const updated: PilotState = {
    ...existing,
    project_blueprint: {
      ...existing.project_blueprint,
      current_stage: nextStage,
    },
    current_stage_id: nextStage.stage_id,
    current_stage_name: nextStage.stage_name,
    current_stage_objective: nextStage.stage_objective,
    next_step_rationale: nextStage.why_this_stage_now,
    latest_feedback_summary: feedbackSummary || existing.latest_feedback_summary,
    execution_feedback_history: appendFeedback(existing.execution_feedback_history, {
      received_at: Date.now(),
      source: feedbackSummary ? "openclaw" : "system",
      raw_feedback: request.feedback ?? request.rawInput ?? "",
      summary: feedbackSummary || "No feedback supplied.",
      pilot_stage_id: existing.current_stage_id,
    }),
    updated_at: Date.now(),
    status: "active",
  };
  const packet = stateToPacket(updated);
  const feedbackContract = buildFeedbackContract(updated);
  const splitNext = renderPlanResponseParts({
    state: updated,
    packet,
    feedbackContract,
  });
  await params.services.states.save({
    ...updated,
    generated_command: splitNext.combinedText,
    generated_command_preview: truncate(splitNext.combinedText, 320),
  });
  return {
    text: splitNext.combinedText,
    messages: splitNext.messages,
  };
}

function buildNextStage(state: PilotState, feedbackSummary: string): PilotBlueprintStage {
  return {
    stage_id: `stage-${shortHash(`${state.pilot_id}:${Date.now()}:${feedbackSummary}`)}`,
    stage_name: feedbackSummary ? "Next stage" : "Stage continuation",
    stage_objective: feedbackSummary || state.current_stage_objective,
    why_this_stage_now: feedbackSummary ? `Based on feedback: ${feedbackSummary}` : "No feedback supplied; continuing the last known stage.",
    in_scope_now: state.project_blueprint.current_stage.in_scope_now,
    out_of_scope_now: state.project_blueprint.current_stage.out_of_scope_now,
    success_criteria: state.project_blueprint.current_stage.success_criteria,
    key_risks: state.project_blueprint.current_stage.key_risks,
    constraints: state.project_blueprint.current_stage.constraints,
  };
}

function buildLookupFromCommand(ctx: PluginCommandContext): {
  sessionKey?: string;
  channel: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  rawTarget?: string;
} {
  let conversationId: string | undefined;
  if (ctx.channel === "telegram") {
    conversationId = normalizeTarget(ctx.to ?? ctx.from);
  } else if (ctx.channel === "discord") {
    conversationId = normalizeTarget(ctx.from ?? ctx.to);
  } else {
    conversationId = normalizeTarget(ctx.to ?? ctx.from);
  }
  return {
    channel: ctx.channel,
    accountId: ctx.accountId,
    conversationId,
    senderId: ctx.senderId,
    rawTarget: normalizeTarget(ctx.to ?? ctx.from),
  };
}

function normalizeTarget(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return truncate(normalizeWhitespace(value), 160);
}

function resolvePilotId(request: PilotRequest): string | undefined {
  return request.pilotId ?? request.approvalId;
}

function resolveRequestedRunMode(request: PilotRequest): PilotRunMode {
  return request.runMode ?? (request.mode === "run" ? "auto_run" : "plan_only");
}

function toProfessionalizerMode(requestedRunMode: PilotRunMode): "draft" | "preview" | "run" {
  return requestedRunMode === "auto_run" ? "run" : "preview";
}

function buildPilotState(params: {
  request: PilotRequest;
  result: ProfessionalizationResult;
  risk: EffectiveRiskDecision;
  context: import("../domain/types.js").GatheredContext;
  runMode: PilotRunMode;
  startedAt: number;
  snapshot: PilotContextSnapshot | undefined;
}): PilotState {
  const pilotId = params.request.pilotId ?? createPilotId(params.request, params.startedAt);
  const stage = buildBlueprintStage(params.result, params.risk, params.runMode);
  const blueprint: PilotBlueprint = {
    pilot_id: pilotId,
    project_goal: params.result.goal,
    core_thesis: params.result.normalized_intent,
    current_stage: stage,
    run_mode: params.runMode,
  };
  const state: PilotState = {
    pilot_id: pilotId,
    project_goal: params.result.goal,
    core_thesis: params.result.normalized_intent,
    project_blueprint: blueprint,
    current_stage_id: stage.stage_id,
    current_stage_name: stage.stage_name,
    current_stage_objective: stage.stage_objective,
    generated_command: "",
    generated_command_preview: "",
    run_mode: params.runMode,
    execution_feedback_history: [],
    latest_feedback_summary: "",
    next_step_rationale: stage.why_this_stage_now,
    risk_level: params.risk.level,
    confirmation_required: params.risk.needConfirmation,
    created_at: params.startedAt,
    updated_at: params.startedAt,
    status: "active",
    context_snapshot: params.snapshot,
    latest_result: params.result,
    output_language: params.result.output_language ?? detectPilotOutputLanguage(params.request.feedback || params.request.rawInput),
  };
  const packet = stateToPacket(state);
  const feedbackContract = buildFeedbackContract(state);
  const generatedCommand = renderPlanResponse({
    state,
    packet,
    feedbackContract,
  });
  return {
    ...state,
    generated_command: generatedCommand,
    generated_command_preview: truncate(generatedCommand, 320),
  };
}

function buildBlueprintStage(
  result: ProfessionalizationResult,
  risk: EffectiveRiskDecision,
  runMode: PilotRunMode,
): PilotBlueprintStage {
  const language = result.output_language ?? detectPilotOutputLanguage(result.original_input);
  return {
    stage_id: `stage-${shortHash(`${result.original_input}:${runMode}:${result.goal}`)}`,
    stage_name: runMode === "auto_run"
      ? (isChinesePilotOutput(language) ? "自动执行阶段" : "Auto-run stage")
      : (isChinesePilotOutput(language) ? "蓝图阶段" : "Blueprint stage"),
    stage_objective: result.task_translation || result.goal,
    why_this_stage_now:
      runMode === "auto_run"
        ? (isChinesePilotOutput(language) ? "用户明确要求本阶段走自动执行模式。" : "The user explicitly requested auto-run for the current stage.")
        : (isChinesePilotOutput(language) ? "默认规划模式应先编译出安全、可直接发送的阶段命令包。" : "Default plan-only mode should compile a safe, ready-to-send stage packet."),
    in_scope_now: result.in_scope.length > 0 ? result.in_scope : result.scope,
    out_of_scope_now: result.out_of_scope.length > 0 ? result.out_of_scope : [isChinesePilotOutput(language) ? "无关工作" : "unrelated work"],
    success_criteria: result.validation_checks.length > 0 ? result.validation_checks : [isChinesePilotOutput(language) ? "当前阶段目标已经可交给 OpenClaw 执行。" : "The stage objective is ready to hand to OpenClaw."],
    key_risks: risk.reasons.length > 0 ? risk.reasons : [isChinesePilotOutput(language) ? "当前轮次没有发现额外风险。" : "No additional risks surfaced by the current pass."],
    constraints: result.constraints.length > 0 ? result.constraints : [isChinesePilotOutput(language) ? "保持范围收敛。" : "Keep scope tight."],
  };
}

function buildFeedbackContract(state: PilotState): PilotFeedbackContract {
  const chinese = isChinesePilotOutput(state.output_language);
  return {
    what_to_send_back: [
      `pilot_id: ${state.pilot_id}`,
      `current_stage_id: ${state.current_stage_id}`,
      `latest_feedback_summary: ${chinese ? "<OpenClaw 结果或阻塞摘要>" : "<summary of OpenClaw result or blocker>"}`,
    ],
    if_blocked: [
      chinese
        ? "如果 OpenClaw 被阻塞，请回传精确阻塞点、被卡住的阶段，以及缺失的输入或权限。"
        : "If OpenClaw is blocked, return the exact blocker, the stage that was blocked, and the missing input or permission.",
      chinese
        ? "如果阶段已完成，请回传具体结果、修改过的文件或产出物，以及后续建议。"
        : "If the stage completes, return the concrete result, changed files or artifacts, and any follow-up recommendation.",
    ],
    next_command_template: `/pilot next ${state.pilot_id} + ${chinese ? "<OpenClaw 反馈>" : "<OpenClaw feedback>"}`,
  };
}

function stateToPacket(state: PilotState): PilotCommandPacket {
  const stage = state.project_blueprint.current_stage;
  const chinese = isChinesePilotOutput(state.output_language);
  return {
    packet_version: "v1",
    pilot_id: state.pilot_id,
    project: state.project_goal,
    stage: stage.stage_name,
    stage_objective: stage.stage_objective,
    why_this_stage_now: stage.why_this_stage_now,
    known_context: buildKnownContext(state),
    in_scope: stage.in_scope_now,
    out_of_scope: stage.out_of_scope_now,
    constraints: stage.constraints,
    execution_plan: [
      chinese
        ? "先审计当前请求对应的表面和上下文。"
        : "Audit the current state for the requested surface.",
      chinese
        ? "编译出最小、可执行且不会范围漂移的阶段命令包。"
        : "Compile the smallest stage packet that OpenClaw can execute without scope drift.",
      chinese
        ? "如果下一步需要更多上下文或更高风险路径，就停止并说明。"
        : "Stop and report if the next step needs more context or a higher-risk path.",
    ],
    deliverables: chinese ? ["蓝图", "可直接发送给 OpenClaw 的命令", "反馈契约"] : ["Blueprint", "Ready-to-send OpenClaw command", "Feedback contract"],
    validation: stage.success_criteria,
    stop_conditions: [
      chinese
        ? "如果本阶段需要比用户当前授权更高风险的运行模式，就停止。"
        : "Stop if the stage requires a higher-risk run mode than the user provided.",
      chinese
        ? "如果命令会扩展到已声明范围之外，就停止。"
        : "Stop if the command would expand outside the stated scope.",
    ],
    do_not: chinese ? ["不要改写项目目标。", "没有反馈前不要进入下一阶段。"] : ["Do not change the project goal.", "Do not advance to the next stage without feedback."],
    return_format: [
      ...(chinese
        ? [
            "状态：done | blocked | needs_input | failed",
            "摘要：",
            "已完成内容：",
            "产出物：",
            "修改文件：",
            "验证结果：",
            "阻塞项：",
            "下一步建议：",
          ]
        : [
            "STATUS: done | blocked | needs_input | failed",
            "SUMMARY:",
            "WHAT_WAS_DONE:",
            "ARTIFACTS:",
            "FILES_CHANGED:",
            "VALIDATION_RESULT:",
            "BLOCKERS:",
            "NEXT_STEP_SUGGESTION:",
          ]),
    ],
  };
}

function buildKnownContext(state: PilotState): string[] {
  const chinese = isChinesePilotOutput(state.output_language);
  const entries = [
    state.context_snapshot?.channel ? `${chinese ? "渠道" : "channel"}: ${state.context_snapshot.channel}` : "",
    state.context_snapshot?.conversationId ? `${chinese ? "会话" : "conversation"}: ${state.context_snapshot.conversationId}` : "",
    state.latest_feedback_summary ? `${chinese ? "最新反馈" : "latest feedback"}: ${state.latest_feedback_summary}` : "",
    state.next_step_rationale ? `${chinese ? "下一步理由" : "next step rationale"}: ${state.next_step_rationale}` : "",
  ].filter(Boolean);
  return entries.length > 0 ? entries : [chinese ? "当前没有额外上下文。" : "No additional context was captured."];
}

function createPilotId(request: PilotRequest, createdAt: number): string {
  return `pilot-${shortHash(`${createdAt}:${request.rawInput}:${request.pilotId ?? "new"}`)}`;
}

function renderRiskRationale(risk: EffectiveRiskDecision): string {
  return risk.reasons.length > 0 ? risk.reasons.join("; ") : "Risk gate triggered by current auto_run policy.";
}

function appendFeedback(entries: PilotFeedbackEntry[], entry: PilotFeedbackEntry): PilotFeedbackEntry[] {
  return [...entries, entry];
}

function summarizeText(value: string): string {
  return truncate(value.replace(/\s+/g, " ").trim(), 240);
}

export function createServices(api: OpenClawPluginApi, pluginConfig: CommandPilotConfig | undefined): PilotRuntimeServices {
  const config = resolvePluginConfig(pluginConfig);
  const stateRoot = path.join(api.runtime.state.resolveStateDir(process.env), "plugins", "command-pilot");
  const cache = new ConversationCache(
    path.join(stateRoot, "context-cache.json"),
    config.context.cacheFileLimit,
  );
  const approvals = new PendingApprovalsStore(path.join(stateRoot, "pending-approvals.json"));
  const states = new PilotStateStore(path.join(stateRoot, "pilot-states.json"));
  return { cache, approvals, states };
}
