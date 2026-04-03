import Ajv from "ajv";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { ParsedPilotCommand, PilotMode } from "../contracts/command.js";
import type { SessionContextBundle } from "../contracts/context.js";
import type { ProfessionalizedCommand } from "../contracts/professionalizer.js";
import type { RiskAssessment } from "../contracts/risk.js";
import type { PilotPluginConfig } from "../config/schema.js";
import { buildProfessionalizerPrompt } from "./prompt.js";
import { professionalizedCommandJsonSchema } from "./schema.js";
import { splitConstraints } from "./intentNormalizer.js";

const AjvCtor = Ajv as unknown as typeof import("ajv").default;
const ajv = new AjvCtor({ allErrors: true, strict: false });
const validateProfessionalizedCommand = ajv.compile(professionalizedCommandJsonSchema);

function collectText(payloads: Array<{ text?: string; isError?: boolean }> | undefined): string {
  return (payloads ?? [])
    .filter((item) => !item.isError && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

function heuristicProfessionalize(params: {
  rawCommand: string;
  mode: PilotMode;
  context: SessionContextBundle;
  risk: RiskAssessment;
}): ProfessionalizedCommand {
  const constraints = splitConstraints(params.rawCommand);
  const requiresAuditFirst = /audit|审计|盘点|inventory|report/i.test(params.rawCommand);
  const normalizedIntent = params.rawCommand.replace(/\s+/g, " ").trim();
  return {
    version: "1",
    original_input: params.rawCommand,
    normalized_intent: normalizedIntent,
    goal: normalizedIntent,
    scope: normalizedIntent,
    constraints,
    assumptions: params.context.recentMessages.length > 0 ? ["Use recent session context to keep changes aligned."] : [],
    deliverables: ["Execution brief", "Action plan", "Implemented result or confirmation gate"],
    execution_mode: params.mode === "run" ? "run" : params.mode === "draft" ? "draft" : "preview",
    risk_level: params.risk.level,
    need_confirmation: params.risk.needConfirmation,
    confirmation_reason: params.risk.reasons[0],
    optimized_instruction: [
      "Act as the execution orchestrator.",
      `Goal: ${normalizedIntent}.`,
      constraints.length > 0 ? `Constraints: ${constraints.join("; ")}.` : "",
      requiresAuditFirst ? "Do an audit and plan first before making changes." : "Proceed in clearly staged steps.",
      params.risk.needConfirmation ? "Do not perform destructive or remote actions until the user confirms." : ""
    ]
      .filter(Boolean)
      .join(" "),
    context_used_summary: {
      sessionKey: params.context.sessionKey,
      channel: params.context.channel,
      recentTurnsUsed: params.context.recentMessages.length,
      standingRulesApplied: params.context.standingOrders.length
    },
    actionable_steps: [
      {
        step: requiresAuditFirst ? "Audit current state and identify the exact work surface." : "Interpret the request against current session context.",
        intent: "clarify",
        risk: "low"
      },
      {
        step: params.risk.needConfirmation
          ? "Prepare a safe plan and wait for explicit confirmation before side effects."
          : "Execute the approved plan in scope.",
        intent: "execute",
        risk: params.risk.level
      }
    ],
    execution_hints: {
      requiresAuditFirst,
      requiresPlanFirst: true,
      avoidActions: params.risk.needConfirmation ? ["destructive writes without confirmation"] : []
    },
    provenance: {
      strategyVersion: "heuristic-v1",
      generatedAt: new Date().toISOString(),
      source: "heuristic"
    }
  };
}

export async function professionalizeCommand(params: {
  api: OpenClawPluginApi;
  parsed: Extract<ParsedPilotCommand, { kind: "execute" }>;
  context: SessionContextBundle;
  risk: RiskAssessment;
  config: PilotPluginConfig;
}): Promise<ProfessionalizedCommand> {
  const { api, parsed, context, risk, config } = params;
  if (config.professionalizer.forceHeuristicFallback) {
    return heuristicProfessionalize({
      rawCommand: parsed.userText,
      mode: parsed.mode,
      context,
      risk
    });
  }

  try {
    const prompt = buildProfessionalizerPrompt({
      rawCommand: parsed.userText,
      mode: parsed.mode,
      context
    });
    const result = await api.runtime.agent.runEmbeddedPiAgent({
      sessionId: `pilot-professionalizer-${Date.now()}`,
      sessionFile: api.runtime.agent.session.resolveSessionFilePath(`command-pilot:professionalizer:${Date.now()}`),
        workspaceDir: api.config.agents?.defaults?.workspace ?? process.cwd(),
        config: api.config,
        prompt,
        runId: `pilot-professionalizer-run-${Date.now()}`,
        provider: config.professionalizer.provider,
        model: config.professionalizer.model,
        thinkLevel: config.professionalizer.thinking,
      timeoutMs: config.professionalizer.timeoutMs,
      streamParams: {
        temperature: config.professionalizer.temperature,
        maxTokens: config.professionalizer.maxTokens
      },
      disableTools: true
    });
    const text = collectText((result as { payloads?: Array<{ text?: string; isError?: boolean }> }).payloads);
    const parsedJson = JSON.parse(text) as ProfessionalizedCommand;
    if (!validateProfessionalizedCommand(parsedJson)) {
      throw new Error("LLM output failed schema validation");
    }
    return parsedJson;
  } catch (error) {
    api.logger.warn(`command-pilot: professionalizer fallback (${String(error)})`);
    return heuristicProfessionalize({
      rawCommand: parsed.userText,
      mode: parsed.mode,
      context,
      risk
    });
  }
}
