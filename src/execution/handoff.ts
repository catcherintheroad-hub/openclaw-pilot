import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { SessionContextBundle } from "../contracts/context.js";
import type { ProfessionalizedCommand } from "../contracts/professionalizer.js";

function collectText(messages: unknown[]): string | null {
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content : typeof record.text === "string" ? record.text : null;
    if (content && content.trim()) {
      return content.trim();
    }
  }
  return null;
}

export async function handoffExecution(params: {
  api: OpenClawPluginApi;
  session: SessionContextBundle;
  professionalized: ProfessionalizedCommand;
  waitTimeoutMs: number;
  deliver: boolean;
}): Promise<{ runId: string; finalText?: string }> {
  if (!params.session.sessionKey) {
    throw new Error("session key unavailable for execution handoff");
  }

  const run = await params.api.runtime.subagent.run({
    sessionKey: params.session.sessionKey,
    message: params.professionalized.optimized_instruction,
    deliver: params.deliver
  });
  await params.api.runtime.subagent.waitForRun({
    runId: run.runId,
    timeoutMs: params.waitTimeoutMs
  });
  const transcript = await params.api.runtime.subagent.getSessionMessages({
    sessionKey: params.session.sessionKey,
    limit: 6
  });
  return {
    runId: run.runId,
    finalText: collectText(transcript.messages ?? []) ?? undefined
  };
}
