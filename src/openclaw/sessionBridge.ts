import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

export type DerivedSessionTarget = {
  sessionKey?: string;
  peerKind: "direct" | "group" | "channel";
  peerId?: string;
};

function clean(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTelegramPeer(to?: string, from?: string): DerivedSessionTarget {
  const raw = clean(to) ?? clean(from);
  if (!raw) {
    return { peerKind: "direct", peerId: clean(from) };
  }
  const threadMatch = raw.match(/^telegram:(-?\d+)(?::(\d+))?$/i);
  if (threadMatch) {
    return {
      peerKind: Number(threadMatch[1]) < 0 ? "group" : "direct",
      peerId: threadMatch[1]
    };
  }
  return {
    peerKind: "direct",
    peerId: raw.replace(/^telegram:/i, "")
  };
}

export function deriveSessionTarget(params: {
  cfg: OpenClawConfig;
  buildAgentSessionKey: (input: {
    agentId: string;
    channel: string;
    accountId?: string | null;
    peer?: { kind: "direct" | "group" | "channel"; id: string } | null;
  }) => string;
  channel: string;
  senderId?: string;
  from?: string;
  to?: string;
  accountId?: string;
}): DerivedSessionTarget {
  const agentId = "main";
  let peerKind: "direct" | "group" | "channel" = "direct";
  let peerId = clean(params.senderId);

  if (params.channel === "telegram") {
    const derived = normalizeTelegramPeer(params.to, params.from);
    peerKind = derived.peerKind;
    peerId = derived.peerId ?? peerId;
  } else if (params.channel === "discord" || params.channel === "slack") {
    const raw = clean(params.to) ?? clean(params.from);
    if (raw?.includes("channel:")) {
      peerKind = "channel";
      peerId = raw.split(":").pop();
    } else {
      peerKind = "direct";
      peerId = clean(params.senderId) ?? raw;
    }
  } else if (params.channel === "webchat") {
    peerKind = "direct";
    peerId = clean(params.senderId) ?? clean(params.from) ?? clean(params.to);
  } else {
    peerKind = "direct";
    peerId = clean(params.senderId) ?? clean(params.from) ?? clean(params.to);
  }

  const sessionKey = peerId
    ? params.buildAgentSessionKey({
        agentId,
        channel: params.channel,
        accountId: params.accountId,
        peer: { kind: peerKind, id: peerId }
      })
    : undefined;

  return { sessionKey, peerKind, peerId };
}
