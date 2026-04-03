export type RiskLevel = "low" | "medium-low" | "medium" | "medium-high" | "high";

export type ExecutionMode = "draft" | "preview" | "run";

export type PilotRunMode = "plan_only" | "auto_run";
export type PilotOutputLanguage = "zh-CN" | "en";

export type PilotCommandAction = "process" | "next" | "status" | "discard" | "confirm" | "continue";

export type PilotContextSnapshot = {
  sessionKey?: string;
  channel: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  rawFrom?: string;
  rawTo?: string;
  messageThreadId?: string | number;
  lastPrompt?: string;
  recentMessages: Array<{
    role: string;
    text: string;
  }>;
  updatedAt: number;
};

export type ProfessionalizationResult = {
  original_input: string;
  normalized_intent: string;
  goal: string;
  scope: string[];
  constraints: string[];
  deliverables: string[];
  execution_mode: ExecutionMode;
  risk_level: RiskLevel;
  need_confirmation: boolean;
  optimized_instruction: string;
  context_used_summary: string[];
  task_objective: string;
  task_translation: string;
  in_scope: string[];
  out_of_scope: string[];
  target_files_or_areas: string[];
  execution_plan: string[];
  validation_checks: string[];
  workspace_hygiene: string[];
  stop_conditions: string[];
  expected_deliverables: string[];
  executor_prompt: string;
  executor_prompt_preview: string;
  schema_validation_ok: boolean;
  run_mode?: PilotRunMode;
  pilot_id?: string;
  project_goal?: string;
  core_thesis?: string;
  current_stage_id?: string;
  current_stage_name?: string;
  current_stage_objective?: string;
  why_this_stage_now?: string;
  success_criteria?: string[];
  key_risks?: string[];
  feedback_contract?: string[];
  generated_command?: string;
  generated_command_preview?: string;
  next_command?: string;
  fallback_reason?: string;
  channel_strategy?: string;
  suggested_plan?: string[];
  risk_reasons?: string[];
  output_language?: PilotOutputLanguage;
};

export type EffectiveRiskDecision = {
  level: RiskLevel;
  needConfirmation: boolean;
  reasons: string[];
  transformedInstruction?: string;
};

export type PilotRequest = {
  action: PilotCommandAction;
  runMode?: PilotRunMode;
  mode: ExecutionMode;
  rawInput: string;
  pilotId?: string;
  feedback?: string;
  approvalId?: string;
};

export type PendingApproval = {
  id: string;
  createdAt: number;
  expiresAt: number;
  pilotId?: string;
  request: PilotRequest;
  context: PilotContextSnapshot;
  result: ProfessionalizationResult;
  risk: EffectiveRiskDecision;
};

export type PilotBlueprintStage = {
  stage_id: string;
  stage_name: string;
  stage_objective: string;
  why_this_stage_now: string;
  in_scope_now: string[];
  out_of_scope_now: string[];
  success_criteria: string[];
  key_risks: string[];
  constraints: string[];
};

export type PilotBlueprint = {
  pilot_id: string;
  project_goal: string;
  core_thesis: string;
  current_stage: PilotBlueprintStage;
  run_mode: PilotRunMode;
};

export type PilotCommandPacket = {
  packet_version: "v1";
  pilot_id: string;
  project: string;
  stage: string;
  stage_objective: string;
  why_this_stage_now: string;
  known_context: string[];
  in_scope: string[];
  out_of_scope: string[];
  constraints: string[];
  execution_plan: string[];
  deliverables: string[];
  validation: string[];
  stop_conditions: string[];
  do_not: string[];
  return_format: string[];
};

export type PilotFeedbackContract = {
  what_to_send_back: string[];
  if_blocked: string[];
  next_command_template: string;
};

export type PilotReplyMessage = {
  role: "assistant";
  text: string;
};

export type PilotRenderedPlan = {
  summaryText: string;
  packetText: string;
  combinedText: string;
  messages: PilotReplyMessage[];
};

export type PilotFeedbackEntry = {
  received_at: number;
  source: "openclaw" | "user" | "system";
  raw_feedback: string;
  summary: string;
  pilot_stage_id?: string;
};

export type PilotState = {
  pilot_id: string;
  project_goal: string;
  core_thesis: string;
  project_blueprint: PilotBlueprint;
  current_stage_id: string;
  current_stage_name: string;
  current_stage_objective: string;
  generated_command: string;
  generated_command_preview: string;
  run_mode: PilotRunMode;
  execution_feedback_history: PilotFeedbackEntry[];
  latest_feedback_summary: string;
  next_step_rationale: string;
  risk_level: RiskLevel;
  confirmation_required: boolean;
  created_at: number;
  updated_at: number;
  status: "active" | "blocked" | "completed" | "discarded";
  context_snapshot?: PilotContextSnapshot;
  latest_result?: ProfessionalizationResult;
  output_language: PilotOutputLanguage;
};

export type StandingOrderExcerpt = {
  path: string;
  content: string;
};

export type GatheredContext = {
  snapshot?: PilotContextSnapshot;
  standingOrders: StandingOrderExcerpt[];
  channelSummary: string[];
};

export type CommandPilotConfig = {
  workspacePath?: string;
  standingOrders?: {
    enabled?: boolean;
    paths?: string[];
    maxCharsPerFile?: number;
  };
  professionalizer?: {
    provider?: string;
    model?: string;
    authProfileId?: string;
    fallbackChain?: Array<{
      provider?: string;
      model?: string;
      authProfileId?: string;
    }>;
    timeoutMs?: number;
    maxTokens?: number;
  };
  execution?: {
    mode?: "embedded-agent";
    timeoutMs?: number;
    autoRunRiskLevels?: RiskLevel[];
  };
  riskPolicyPath?: string;
  context?: {
    historyTurns?: number;
    maxMessages?: number;
    cacheFileLimit?: number;
  };
};

export type ResolvedCommandPilotConfig = {
  workspacePath: string;
  standingOrders: {
    enabled: boolean;
    paths: string[];
    maxCharsPerFile: number;
  };
  professionalizer: {
    provider: string;
    model: string;
    authProfileId: string;
    fallbackChain: Array<{
      provider: string;
      model: string;
      authProfileId: string;
    }>;
    timeoutMs: number;
    maxTokens: number;
  };
  execution: {
    mode: "embedded-agent";
    timeoutMs: number;
    autoRunRiskLevels: RiskLevel[];
  };
  riskPolicyPath: string;
  context: {
    historyTurns: number;
    maxMessages: number;
    cacheFileLimit: number;
  };
};

export type RiskRule = {
  id: string;
  match: string;
  riskLevel: RiskLevel;
  action: "confirm" | "inventory-first";
  reason: string;
};

export type RiskPolicy = {
  blockedSilentPatterns: RiskRule[];
  destructiveHints: string[];
  defaultAutoRunRiskLevels: RiskLevel[];
};

export type ExecutionResult = {
  status: "completed" | "failed";
  summary: string;
  rawText?: string;
  handoffPromptSource?: "executor_prompt" | "optimized_instruction" | "blocked";
  gateDecision?: string;
};
