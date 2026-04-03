import type { GatheredContext } from "../domain/types.js";
import { ConversationCache } from "./conversation-cache.js";
import { buildContextSummary, sanitizeSnapshot } from "./context-sanitizer.js";
import { readStandingOrders } from "./standing-orders.js";

export async function gatherContext(params: {
  cache: ConversationCache;
  workspacePath: string;
  standingOrdersEnabled: boolean;
  standingOrderPaths: string[];
  standingOrdersMaxChars: number;
  lookup: {
    sessionKey?: string;
    channel: string;
    accountId?: string;
    conversationId?: string;
    senderId?: string;
    rawTarget?: string;
  };
}): Promise<GatheredContext> {
  const snapshot = sanitizeSnapshot(params.cache.find(params.lookup));
  const standingOrders = params.standingOrdersEnabled
    ? await readStandingOrders({
        workspacePath: params.workspacePath,
        paths: params.standingOrderPaths,
        maxCharsPerFile: params.standingOrdersMaxChars,
      })
    : [];

  const context: GatheredContext = {
    snapshot,
    standingOrders,
    channelSummary: [],
  };

  return {
    ...context,
    channelSummary: buildContextSummary(context),
  };
}
