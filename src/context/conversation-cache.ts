import fs from "node:fs/promises";
import path from "node:path";
import type { PilotContextSnapshot } from "../domain/types.js";
import { shortHash } from "../utils/hash.js";

type PersistedState = {
  snapshots: PilotContextSnapshot[];
};

export class ConversationCache {
  private readonly bySessionKey = new Map<string, PilotContextSnapshot>();
  private readonly byConversationKey = new Map<string, PilotContextSnapshot>();
  private readonly bySenderKey = new Map<string, PilotContextSnapshot>();

  constructor(
    private readonly cacheFile: string,
    private readonly maxEntries: number,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.cacheFile, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;
      for (const snapshot of parsed.snapshots ?? []) {
        this.remember(snapshot);
      }
    } catch {
      // Ignore empty state.
    }
  }

  async persist(): Promise<void> {
    const snapshots = Array.from(this.bySessionKey.values())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, this.maxEntries);
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(this.cacheFile, JSON.stringify({ snapshots }, null, 2));
  }

  remember(snapshot: PilotContextSnapshot): void {
    if (snapshot.sessionKey) {
      this.bySessionKey.set(snapshot.sessionKey, snapshot);
    }
    this.byConversationKey.set(buildConversationKey(snapshot), snapshot);
    if (snapshot.senderId) {
      this.bySenderKey.set(buildSenderKey(snapshot), snapshot);
    }
  }

  find(params: {
    sessionKey?: string;
    channel: string;
    accountId?: string;
    conversationId?: string;
    senderId?: string;
    rawTarget?: string;
  }): PilotContextSnapshot | undefined {
    if (params.sessionKey) {
      const direct = this.bySessionKey.get(params.sessionKey);
      if (direct) {
        return direct;
      }
    }
    if (params.conversationId) {
      const byConversation = this.byConversationKey.get(
        `${params.channel}::${params.accountId ?? "default"}::${params.conversationId}`,
      );
      if (byConversation) {
        return byConversation;
      }
    }
    if (params.rawTarget) {
      const byTarget = Array.from(this.byConversationKey.entries()).find(([key]) =>
        key.endsWith(`::${params.rawTarget}`),
      );
      if (byTarget) {
        return byTarget[1];
      }
    }
    if (params.senderId) {
      return this.bySenderKey.get(`${params.channel}::${params.accountId ?? "default"}::${params.senderId}`);
    }
    return undefined;
  }
}

function buildConversationKey(snapshot: PilotContextSnapshot): string {
  const conversationId =
    snapshot.conversationId ??
    snapshot.rawTo ??
    snapshot.rawFrom ??
    `anon:${shortHash(JSON.stringify(snapshot.recentMessages))}`;
  return `${snapshot.channel}::${snapshot.accountId ?? "default"}::${conversationId}`;
}

function buildSenderKey(snapshot: PilotContextSnapshot): string {
  return `${snapshot.channel}::${snapshot.accountId ?? "default"}::${snapshot.senderId ?? "unknown"}`;
}
