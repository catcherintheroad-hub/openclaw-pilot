export type SessionMessage = {
  role: string;
  content: string;
};

export type SessionContextBundle = {
  sessionKey?: string;
  sessionId?: string;
  channel: string;
  senderId?: string;
  accountId?: string;
  threadId?: string | number;
  recentMessages: SessionMessage[];
  standingOrders: string[];
  sessionSummary: string;
};
