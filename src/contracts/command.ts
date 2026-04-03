export type PilotMode = "auto" | "draft" | "preview" | "run";

export type ParsedPilotCommand =
  | {
      kind: "execute";
      mode: PilotMode;
      rawInput: string;
      userText: string;
    }
  | {
      kind: "confirm";
      approvalId: string;
    }
  | {
      kind: "cancel";
      approvalId: string;
    }
  | {
      kind: "help";
    };

export type PilotCommandEnvelope = {
  rawInput: string;
  commandName: "pilot";
  mode: PilotMode;
  sourceChannel: string;
  sessionKey?: string;
  sessionId?: string;
  senderId?: string;
};
