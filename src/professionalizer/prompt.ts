import type { ExecutionMode, GatheredContext } from "../domain/types.js";
import { buildPromptConversationLines } from "../context/context-sanitizer.js";
import { detectPilotOutputLanguage, isChinesePilotOutput } from "../utils/language.js";

export function buildProfessionalizerPrompt(params: {
  input: string;
  mode: ExecutionMode;
  context: GatheredContext;
}): string {
  const outputLanguage = detectPilotOutputLanguage(params.input);
  const chineseOutput = isChinesePilotOutput(outputLanguage);
  const standingOrders = params.context.standingOrders
    .map((entry) => `FILE: ${entry.path}\n${entry.content}`)
    .join("\n\n");
  const recentMessages = buildPromptConversationLines(params.context).join("\n");

  return [
    "You are Command Pilot, an intent compiler for OpenClaw.",
    "Compile the user's rough project idea into a structured project blueprint plus a ready-to-send OpenClaw execution packet.",
    "Return JSON only. No markdown fences. No commentary.",
    "The primary product is a blueprint, current stage framing, generated command packet text, feedback contract, and next command.",
    "You must identify goal, scope, constraints, deliverables, execution mode, risk level, need_confirmation, and optimized_instruction.",
    "The JSON must always include original_input, normalized_intent, project_goal, core_thesis, pilot_id, current_stage_id, current_stage_name, current_stage_objective, why_this_stage_now, success_criteria, key_risks, generated_command, generated_command_preview, next_command, feedback_contract, context_used_summary, task_objective, task_translation, in_scope, out_of_scope, target_files_or_areas, execution_plan, validation_checks, workspace_hygiene, stop_conditions, expected_deliverables, and executor_prompt.",
    "generated_command must be a full OpenClaw execution packet. executor_prompt remains a --run compatibility field and should not become the main artifact.",
    chineseOutput
      ? "The user's current message is primarily Simplified Chinese. All human-readable JSON fields, generated_command content, field descriptions, and helper text must default to Simplified Chinese. Only [OPENCLAW_EXECUTION_PACKET v1] and [END_OPENCLAW_EXECUTION_PACKET] may stay literal."
      : "Follow the user's current message language for all human-readable JSON fields, generated_command content, field descriptions, and helper text.",
    "If the request implies deletion, remote mutation, privilege escalation, or production impact, bias toward safer staged plans and confirmation.",
    "Use only concise context signals. Do not quote or echo raw transcript noise, metadata wrappers, restart logs, or earlier Command Pilot briefs.",
    `Execution mode requested: ${params.mode}`,
    "",
    "CONTEXT SUMMARY",
    ...params.context.channelSummary,
    "",
    "SELECTED RECENT TASK MESSAGES",
    recentMessages || "(none)",
    "",
    "STANDING ORDERS",
    standingOrders || "(none)",
    "",
    "USER INPUT",
    params.input,
  ].join("\n");
}
