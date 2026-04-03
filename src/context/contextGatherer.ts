import type { OpenClawPluginApi, PluginCommandContext } from "openclaw/plugin-sdk/core";
import type { SessionContextBundle, SessionMessage } from "../contracts/context.js";
import type { PilotPluginConfig } from "../config/schema.js";
import { mergeStandingRules } from "./standingRules.js";
import { deriveSessionTarget } from "../openclaw/sessionBridge.js";

function normalizeMessage(value: unknown): SessionMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role =
    typeof record.role === "string"
      ? record.role
      : typeof record.sender === "string"
        ? record.sender
        : "unknown";
  const content =
    typeof record.content === "string"
      ? record.content
      : typeof record.text === "string"
        ? record.text
        : Array.isArray(record.content)
          ? record.content.filter((part) => typeof part === "string").join("\n")
          : "";
  if (!content.trim()) {
    return null;
  }
  return { role, content: content.trim() };
}

export async function gatherSessionContext(params: {
  api: OpenClawPluginApi;
  ctx: PluginCommandContext;
  config: PilotPluginConfig;
}): Promise<SessionContextBundle> {
  const { api, ctx, config } = params;
  const target = deriveSessionTarget({
    cfg: api.config,
    buildAgentSessionKey: api.runtime.channel.routing.buildAgentSessionKey,
    channel: ctx.channel,
    senderId: ctx.senderId,
    from: ctx.from,
    to: ctx.to,
    accountId: ctx.accountId
  });

  let recentMessages: SessionMessage[] = [];
  if (target.sessionKey) {
    try {
      const result = await api.runtime.subagent.getSessionMessages({
        sessionKey: target.sessionKey,
        limit: config.maxHistoryMessages
      });
      recentMessages = (result.messages ?? [])
        .map(normalizeMessage)
        .filter((entry): entry is SessionMessage => Boolean(entry))
        .slice(-config.recentTurns);
    } catch (error) {
      api.logger.warn(`command-pilot: failed to load session messages (${String(error)})`);
    }
  }

  return {
    sessionKey: target.sessionKey,
    sessionId: target.sessionKey,
    channel: ctx.channel,
    senderId: ctx.senderId,
    accountId: ctx.accountId,
    threadId: ctx.messageThreadId,
    recentMessages,
    standingOrders: mergeStandingRules(config.standingOrders),
    sessionSummary: recentMessages
      .slice(-3)
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join("\n")
  };
}
