import type { ParsedPilotCommand } from "../contracts/command.js";

export function parsePilotCommand(rawArgs: string | undefined): ParsedPilotCommand {
  const raw = (rawArgs ?? "").trim();
  if (!raw) {
    return { kind: "help" };
  }
  const confirmMatch = raw.match(/^(confirm|approve)\s+([a-z0-9]+)$/i);
  if (confirmMatch) {
    return { kind: "confirm", approvalId: confirmMatch[2] };
  }
  const cancelMatch = raw.match(/^(cancel|deny)\s+([a-z0-9]+)$/i);
  if (cancelMatch) {
    return { kind: "cancel", approvalId: cancelMatch[2] };
  }

  const flags = raw.split(/\s+/);
  let mode: "auto" | "draft" | "preview" | "run" = "auto";
  const consumed = new Set<number>();
  flags.forEach((token, index) => {
    if (token === "--draft") {
      mode = "draft";
      consumed.add(index);
    } else if (token === "--preview") {
      mode = "preview";
      consumed.add(index);
    } else if (token === "--run") {
      mode = "run";
      consumed.add(index);
    }
  });

  const userText = flags.filter((_token, index) => !consumed.has(index)).join(" ").trim();
  if (!userText) {
    return { kind: "help" };
  }
  return {
    kind: "execute",
    mode,
    rawInput: raw,
    userText
  };
}
