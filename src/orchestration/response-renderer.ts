import type {
  EffectiveRiskDecision,
  ExecutionResult,
  GatheredContext,
  PendingApproval,
  PilotCommandPacket,
  PilotFeedbackContract,
  PilotOutputLanguage,
  PilotRenderedPlan,
  PilotReplyMessage,
  PilotState,
  ProfessionalizationResult,
} from "../domain/types.js";
import { COMMAND_PILOT_BUILD_ID } from "../build-info.js";
import { detectPilotOutputLanguage, isChinesePilotOutput } from "../utils/language.js";

const PILOT_RENDERER_VERSION = "response-renderer-live-v1";

function renderValueList(values: string[], emptyValue = "(none)"): string {
  return values.length > 0 ? values.map((entry) => `- ${entry}`).join("\n") : `- ${emptyValue}`;
}

function renderInline(values: string[], emptyValue = "(none)"): string {
  return values.length > 0 ? values.join("; ") : emptyValue;
}

function localize(language: PilotOutputLanguage, zh: string, en: string): string {
  return isChinesePilotOutput(language) ? zh : en;
}

function renderRunMode(language: PilotOutputLanguage, runMode: PilotState["run_mode"]): string {
  if (isChinesePilotOutput(language)) {
    return runMode === "auto_run" ? "自动执行" : "规划模式";
  }
  return runMode;
}

function resolveLanguageFromState(state: Pick<PilotState, "output_language" | "project_goal" | "core_thesis" | "latest_result">): PilotOutputLanguage {
  return state.output_language
    ?? state.latest_result?.output_language
    ?? detectPilotOutputLanguage(state.project_goal || state.core_thesis);
}

function traceRenderLocale(state: PilotState, language: PilotOutputLanguage): void {
  if ((globalThis as { __OPENCLAW_COMMAND_PILOT_DEBUG_LOCALE__?: boolean }).__OPENCLAW_COMMAND_PILOT_DEBUG_LOCALE__ !== true) {
    return;
  }
  const globalLogger = (globalThis as { __OPENCLAW_COMMAND_PILOT_TRACE_LOG__?: { info?: (message: string) => void } }).__OPENCLAW_COMMAND_PILOT_TRACE_LOG__;
  globalLogger?.info?.(
    `command-pilot: renderer locale trace resolved=${language} state_output=${state.output_language ?? "unset"} latest_result=${state.latest_result?.output_language ?? "unset"} goal_detected=${detectPilotOutputLanguage(state.project_goal || state.core_thesis)}`,
  );
}

function buildPreviewState(params: {
  result: ProfessionalizationResult;
  risk: EffectiveRiskDecision;
  context: GatheredContext;
}): PilotState {
  const now = Date.now();
  const language = params.result.output_language ?? detectPilotOutputLanguage(params.result.original_input);
  const pilotId = params.result.pilot_id ?? "pilot-pending";
  const stageId = params.result.current_stage_id ?? "stage-1";
  const stageName = params.result.current_stage_name ?? localize(language, "阶段 1：项目蓝图界定", "Stage 1: project framing");
  const stageObjective = params.result.current_stage_objective ?? params.result.task_translation ?? params.result.goal;
  const whyThisStageNow =
    params.result.why_this_stage_now
    ?? params.result.execution_plan[0]
    ?? localize(language, "先把当前阶段编译成可执行命令包。", "Compile the current stage into an executable packet.");
  const inScope = params.result.in_scope ?? [];
  const outOfScope = params.result.out_of_scope ?? [];
  const successCriteria = params.result.success_criteria ?? params.result.validation_checks ?? [];
  const keyRisks = params.result.key_risks ?? params.result.stop_conditions ?? [];
  const constraints = params.result.constraints ?? [];
  const runMode = params.result.run_mode ?? "plan_only";
  const projectGoal = params.result.project_goal ?? params.result.goal;
  const coreThesis = params.result.core_thesis ?? params.result.normalized_intent;
  return {
    pilot_id: pilotId,
    project_goal: projectGoal,
    core_thesis: coreThesis,
    project_blueprint: {
      pilot_id: pilotId,
      project_goal: projectGoal,
      core_thesis: coreThesis,
      current_stage: {
        stage_id: stageId,
        stage_name: stageName,
        stage_objective: stageObjective,
        why_this_stage_now: whyThisStageNow,
        in_scope_now: inScope,
        out_of_scope_now: outOfScope,
        success_criteria: successCriteria,
        key_risks: keyRisks,
        constraints,
      },
      run_mode: runMode,
    },
    current_stage_id: stageId,
    current_stage_name: stageName,
    current_stage_objective: stageObjective,
    generated_command: params.result.generated_command ?? "",
    generated_command_preview: params.result.generated_command_preview ?? "",
    run_mode: runMode,
    execution_feedback_history: [],
    latest_feedback_summary: params.risk.reasons.join("; "),
    next_step_rationale: whyThisStageNow,
    risk_level: params.risk.level,
    confirmation_required: params.risk.needConfirmation,
    created_at: now,
    updated_at: now,
    status: params.risk.needConfirmation ? "blocked" : "active",
    context_snapshot: params.context.snapshot,
    latest_result: params.result,
    output_language: language,
  };
}

function renderBlueprint(state: PilotState): string {
  const stage = state.project_blueprint.current_stage;
  const language = resolveLanguageFromState(state);
  return [
    localize(language, "A. Command Pilot 蓝图", "A. Command Pilot Blueprint"),
    `${localize(language, "蓝图 ID", "Pilot ID")}: ${state.pilot_id}`,
    `${localize(language, "项目目标", "Project Goal")}: ${state.project_goal}`,
    `${localize(language, "核心论点", "Core Thesis")}: ${state.core_thesis}`,
    `${localize(language, "当前阶段", "Current Stage")}: ${stage.stage_name}`,
    `${localize(language, "为什么现在做这一阶段", "Why this stage now")}: ${stage.why_this_stage_now}`,
    `${localize(language, "本轮范围内", "In scope now")}: ${renderInline(stage.in_scope_now, localize(language, "（无）", "(none)"))}`,
    `${localize(language, "本轮范围外", "Out of scope now")}: ${renderInline(stage.out_of_scope_now, localize(language, "（无）", "(none)"))}`,
    `${localize(language, "成功标准", "Success criteria")}: ${renderInline(stage.success_criteria, localize(language, "（无）", "(none)"))}`,
    `${localize(language, "关键风险", "Key risks")}: ${renderInline(stage.key_risks, localize(language, "（无）", "(none)"))}`,
    `${localize(language, "运行模式", "Run mode")}: ${renderRunMode(language, state.run_mode)}`,
  ].join("\n");
}

function renderReadyCommand(packet: PilotCommandPacket, language: PilotOutputLanguage): string {
  return [
    localize(language, "B. 可直接发送给 OpenClaw 的命令", "B. Ready-to-send OpenClaw Command"),
    "[OPENCLAW_EXECUTION_PACKET v1]",
    "",
    localize(language, "角色：", "ROLE:"),
    localize(language, "你是 OpenClaw 执行代理。你的职责是只完成当前阶段目标，不擅自扩展到下一阶段。", "You are the OpenClaw execution agent. Complete only the current stage objective and do not expand into the next stage on your own."),
    "",
    localize(language, "项目：", "PROJECT:"),
    packet.project,
    "",
    localize(language, "阶段：", "STAGE:"),
    packet.stage,
    "",
    localize(language, "阶段目标：", "STAGE_OBJECTIVE:"),
    packet.stage_objective,
    "",
    localize(language, "为什么现在做这一阶段：", "WHY_THIS_STAGE_NOW:"),
    packet.why_this_stage_now,
    "",
    localize(language, "已知上下文：", "KNOWN_CONTEXT:"),
    renderValueList(packet.known_context, localize(language, "（无）", "(none)")),
    "",
    localize(language, "本轮范围内：", "IN_SCOPE:"),
    renderValueList(packet.in_scope, localize(language, "（无）", "(none)")),
    "",
    localize(language, "本轮范围外：", "OUT_OF_SCOPE:"),
    renderValueList(packet.out_of_scope, localize(language, "（无）", "(none)")),
    "",
    localize(language, "约束条件：", "CONSTRAINTS:"),
    renderValueList(packet.constraints, localize(language, "（无）", "(none)")),
    "",
    localize(language, "执行计划：", "EXECUTION_PLAN:"),
    packet.execution_plan.map((entry, index) => `${index + 1}. ${entry}`).join("\n"),
    "",
    localize(language, "交付物：", "DELIVERABLES:"),
    renderValueList(packet.deliverables, localize(language, "（无）", "(none)")),
    "",
    localize(language, "验证方式：", "VALIDATION:"),
    renderValueList(packet.validation, localize(language, "（无）", "(none)")),
    "",
    localize(language, "停止条件：", "STOP_CONDITIONS:"),
    renderValueList(packet.stop_conditions, localize(language, "（无）", "(none)")),
    "",
    localize(language, "不要做的事：", "DO_NOT:"),
    renderValueList(packet.do_not, localize(language, "（无）", "(none)")),
    "",
    localize(language, "回传格式：", "RETURN_FORMAT:"),
    renderValueList(packet.return_format, localize(language, "（无）", "(none)")),
    "",
    "[END_OPENCLAW_EXECUTION_PACKET]",
  ].join("\n");
}

function renderPacketBodyOnly(packet: PilotCommandPacket, language: PilotOutputLanguage): string {
  return [
    "[OPENCLAW_EXECUTION_PACKET v1]",
    "",
    localize(language, "角色：", "ROLE:"),
    localize(language, "你是 OpenClaw 执行代理。你的职责是只完成当前阶段目标，不擅自扩展到下一阶段。", "You are the OpenClaw execution agent. Complete only the current stage objective and do not expand into the next stage on your own."),
    "",
    localize(language, "项目：", "PROJECT:"),
    packet.project,
    "",
    localize(language, "阶段：", "STAGE:"),
    packet.stage,
    "",
    localize(language, "阶段目标：", "STAGE_OBJECTIVE:"),
    packet.stage_objective,
    "",
    localize(language, "为什么现在做这一阶段：", "WHY_THIS_STAGE_NOW:"),
    packet.why_this_stage_now,
    "",
    localize(language, "已知上下文：", "KNOWN_CONTEXT:"),
    renderValueList(packet.known_context, localize(language, "（无）", "(none)")),
    "",
    localize(language, "本轮范围内：", "IN_SCOPE:"),
    renderValueList(packet.in_scope, localize(language, "（无）", "(none)")),
    "",
    localize(language, "本轮范围外：", "OUT_OF_SCOPE:"),
    renderValueList(packet.out_of_scope, localize(language, "（无）", "(none)")),
    "",
    localize(language, "约束条件：", "CONSTRAINTS:"),
    renderValueList(packet.constraints, localize(language, "（无）", "(none)")),
    "",
    localize(language, "执行计划：", "EXECUTION_PLAN:"),
    packet.execution_plan.map((entry, index) => `${index + 1}. ${entry}`).join("\n"),
    "",
    localize(language, "交付物：", "DELIVERABLES:"),
    renderValueList(packet.deliverables, localize(language, "（无）", "(none)")),
    "",
    localize(language, "验证方式：", "VALIDATION:"),
    renderValueList(packet.validation, localize(language, "（无）", "(none)")),
    "",
    localize(language, "停止条件：", "STOP_CONDITIONS:"),
    renderValueList(packet.stop_conditions, localize(language, "（无）", "(none)")),
    "",
    localize(language, "不要做的事：", "DO_NOT:"),
    renderValueList(packet.do_not, localize(language, "（无）", "(none)")),
    "",
    localize(language, "回传格式：", "RETURN_FORMAT:"),
    renderValueList(packet.return_format, localize(language, "（无）", "(none)")),
    "",
    "[END_OPENCLAW_EXECUTION_PACKET]",
  ].join("\n");
}

function renderFeedbackContract(contract: PilotFeedbackContract, language: PilotOutputLanguage): string {
  return [
    localize(language, "C. 应回传给 /pilot 的内容", "C. What to send back"),
    `- ${localize(language, "把 OpenClaw 返回的这些字段喂回 /pilot", "Send these OpenClaw fields back into /pilot")}: ${contract.what_to_send_back.join(" | ")}`,
    `- ${localize(language, "如果被阻塞", "If blocked")}: ${contract.if_blocked.join(" ")}`,
    `- ${localize(language, "下一次继续命令", "Next command to continue")}: ${contract.next_command_template}`,
  ].join("\n");
}

export function renderNextCommand(state: PilotState): string {
  const language = resolveLanguageFromState(state);
  if (state.run_mode === "auto_run") {
    return [
      localize(language, "D. 下一条命令", "D. Next command"),
      `- ${localize(language, "已发送给 OpenClaw", "Sent to OpenClaw")}`,
      `- ${localize(language, "用", "Use")} /pilot status ${state.pilot_id} ${localize(language, "查看状态", "to view status")}`,
      `- ${localize(language, "用", "Use")} /pilot next ${state.pilot_id} ${localize(language, "基于反馈生成下一阶段命令", "to generate the next-stage command from feedback")}`,
    ].join("\n");
  }
  return [
    localize(language, "D. 下一条命令", "D. Next command"),
    `/pilot next ${state.pilot_id}`,
  ].join("\n");
}

export function renderPlanResponse(params: {
  state: PilotState;
  packet: PilotCommandPacket;
  feedbackContract: PilotFeedbackContract;
}): string {
  const language = resolveLanguageFromState(params.state);
  traceRenderLocale(params.state, language);
  return [
    renderBlueprint(params.state),
    "",
    renderReadyCommand(params.packet, language),
    "",
    renderFeedbackContract(params.feedbackContract, language),
    "",
    renderNextCommand(params.state),
    "",
    `${localize(language, "渲染器版本", "Pilot renderer version")}: ${PILOT_RENDERER_VERSION}`,
    `${localize(language, "构建版本", "Build")}: ${COMMAND_PILOT_BUILD_ID}`,
  ].join("\n");
}

export function renderPlanResponseParts(params: {
  state: PilotState;
  packet: PilotCommandPacket;
  feedbackContract: PilotFeedbackContract;
  executionText?: string;
}): PilotRenderedPlan {
  const language = resolveLanguageFromState(params.state);
  traceRenderLocale(params.state, language);
  const packetSection = renderReadyCommand(params.packet, language);
  const packetText = renderPacketBodyOnly(params.packet, language);
  const summaryLines = [
    renderBlueprint(params.state),
    "",
    localize(
      language,
      "B. 可直接发送给 OpenClaw 的命令",
      "B. Ready-to-send OpenClaw Command",
    ),
    localize(
      language,
      "可直接发送给 OpenClaw 的命令已在下一条消息单独发送",
      "The ready-to-send OpenClaw command has been sent as a separate message below",
    ),
    "",
    renderFeedbackContract(params.feedbackContract, language),
    "",
    renderNextCommand(params.state),
    ...(params.executionText ? ["", params.executionText] : []),
    "",
    `${localize(language, "渲染器版本", "Pilot renderer version")}: ${PILOT_RENDERER_VERSION}`,
    `${localize(language, "构建版本", "Build")}: ${COMMAND_PILOT_BUILD_ID}`,
  ];
  const summaryText = summaryLines.join("\n");
  const messages: PilotReplyMessage[] = [
    { role: "assistant", text: summaryText },
    { role: "assistant", text: packetText },
  ];
  return {
    summaryText,
    packetText,
    combinedText: [renderBlueprint(params.state), "", packetSection, "", renderFeedbackContract(params.feedbackContract, language), "", renderNextCommand(params.state), ...(params.executionText ? ["", params.executionText] : []), "", `${localize(language, "渲染器版本", "Pilot renderer version")}: ${PILOT_RENDERER_VERSION}`, `${localize(language, "构建版本", "Build")}: ${COMMAND_PILOT_BUILD_ID}`].join("\n"),
    messages,
  };
}

export function renderStatus(state: PilotState): string {
  const language = resolveLanguageFromState(state);
  traceRenderLocale(state, language);
  return [
    renderBlueprint(state),
    "",
    localize(language, "C. 应回传给 /pilot 的内容", "C. What to send back"),
    `- ${localize(language, "最新反馈摘要", "Latest feedback summary")}: ${state.latest_feedback_summary || localize(language, "（无）", "(none)")}`,
    `- ${localize(language, "反馈历史条数", "Feedback history entries")}: ${state.execution_feedback_history.length}`,
    `- ${localize(language, "下一步理由", "Next step rationale")}: ${state.next_step_rationale}`,
    "",
    renderNextCommand(state),
    "",
    `${localize(language, "渲染器版本", "Pilot renderer version")}: ${PILOT_RENDERER_VERSION}`,
    `${localize(language, "构建版本", "Build")}: ${COMMAND_PILOT_BUILD_ID}`,
  ].join("\n");
}

export function renderPreview(params: {
  result: ProfessionalizationResult;
  risk: EffectiveRiskDecision;
  context: GatheredContext;
}): string {
  const state = buildPreviewState(params);
  const packet: PilotCommandPacket = {
    packet_version: "v1",
    pilot_id: state.pilot_id,
    project: state.project_goal,
    stage: state.current_stage_name,
    stage_objective: state.current_stage_objective,
    why_this_stage_now: state.next_step_rationale,
    known_context: params.result.context_used_summary.length > 0 ? params.result.context_used_summary : params.context.channelSummary,
    in_scope: state.project_blueprint.current_stage.in_scope_now,
    out_of_scope: state.project_blueprint.current_stage.out_of_scope_now,
    constraints: state.project_blueprint.current_stage.constraints,
    execution_plan: params.result.execution_plan ?? [],
    deliverables: params.result.expected_deliverables ?? [],
    validation: state.project_blueprint.current_stage.success_criteria,
    stop_conditions: params.result.stop_conditions ?? [],
    do_not: [
      "不要擅自改写项目目标",
      "不要进入下一阶段",
      "不要做未明确授权的危险操作",
      "不要把“建议”伪装成“已完成”",
    ],
    return_format: params.result.feedback_contract ?? [],
  };
  const feedbackContract: PilotFeedbackContract = {
    what_to_send_back: params.result.feedback_contract ?? [],
    if_blocked: [
      "回传阻塞原因原文。",
      "回传缺少的关键输入、权限或依赖。",
      "如果 OpenClaw 停在风险或权限边界，也要把该说明完整带回。",
    ],
    next_command_template: `/pilot next ${state.pilot_id} [OpenClaw feedback]`,
  };
  return renderPlanResponse({ state, packet, feedbackContract });
}

export function renderApprovalNeeded(approval: PendingApproval): string {
  const language = approval.result.output_language ?? detectPilotOutputLanguage(approval.result.original_input);
  return [
    renderPreview({
      result: approval.result,
      risk: approval.risk,
      context: {
        snapshot: approval.context,
        standingOrders: [],
        channelSummary: [],
      },
    }),
    "",
    `${localize(language, "待确认审批 ID", "Pending approval id")}: ${approval.id}`,
    `${localize(language, "确认命令", "Confirm with")}: /pilot confirm ${approval.id}`,
    `${localize(language, "放弃命令", "Discard with")}: /pilot discard ${approval.pilotId}`,
  ].join("\n");
}

export function renderContinueNeeded(approval: PendingApproval): string {
  const language = approval.result.output_language ?? detectPilotOutputLanguage(approval.result.original_input);
  return [
    renderApprovalNeeded(approval),
    "",
    `${localize(language, "继续命令", "Continue with")}: /pilot continue ${approval.id}`,
  ].join("\n");
}

export function renderExecutionResult(result: ExecutionResult, language: PilotOutputLanguage = "en"): string {
  return [
    `${localize(language, "执行状态", "Execution status")}: ${result.status}`,
    result.handoffPromptSource ? `${localize(language, "交接提示来源", "Handoff prompt source")}: ${result.handoffPromptSource}` : "",
    result.gateDecision ? `${localize(language, "门控结论", "Gate decision")}: ${result.gateDecision}` : "",
    "",
    result.summary,
  ].filter(Boolean).join("\n");
}
