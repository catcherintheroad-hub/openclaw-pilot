import type { ExecutionMode, PilotRequest, PilotRunMode } from "../domain/types.js";

function legacyModeForRunMode(runMode: PilotRunMode): ExecutionMode {
  return runMode === "auto_run" ? "run" : "preview";
}

function parsePilotIdentifier(tokens: string[]): string | undefined {
  return tokens[1]?.trim() || undefined;
}

function parseFeedbackTail(rawArgs: string): string {
  const pieces = rawArgs.trim().split(/\s+/);
  const feedback = pieces.slice(2).join(" ").trim();
  return feedback.replace(/^\+\s*/, "");
}

export function parsePilotCommand(rawArgs: string | undefined): PilotRequest {
  const value = (rawArgs ?? "").trim();
  if (!value) {
    return {
      action: "process",
      runMode: "plan_only",
      mode: legacyModeForRunMode("plan_only"),
      rawInput: "",
    };
  }

  const tokens = value.split(/\s+/);
  const first = tokens[0]?.toLowerCase();

  if (first === "status") {
    return {
      action: "status",
      runMode: "plan_only",
      mode: legacyModeForRunMode("plan_only"),
      rawInput: "",
      pilotId: parsePilotIdentifier(tokens),
      approvalId: parsePilotIdentifier(tokens),
    };
  }

  if (first === "next") {
    const pilotId = parsePilotIdentifier(tokens);
    return {
      action: "next",
      runMode: "plan_only",
      mode: legacyModeForRunMode("plan_only"),
      rawInput: "",
      pilotId,
      feedback: parseFeedbackTail(value),
    };
  }

  if (first === "discard") {
    const pilotId = parsePilotIdentifier(tokens);
    return {
      action: "discard",
      runMode: "plan_only",
      mode: legacyModeForRunMode("plan_only"),
      rawInput: "",
      pilotId,
      approvalId: pilotId,
    };
  }

  if (first === "confirm") {
    const approvalId = parsePilotIdentifier(tokens);
    return {
      action: "confirm",
      runMode: "auto_run",
      mode: legacyModeForRunMode("auto_run"),
      rawInput: "",
      pilotId: approvalId,
      approvalId,
    };
  }

  if (first === "continue") {
    const approvalId = parsePilotIdentifier(tokens);
    return {
      action: "continue",
      runMode: "auto_run",
      mode: legacyModeForRunMode("auto_run"),
      rawInput: "",
      pilotId: approvalId,
      approvalId,
    };
  }

  let runMode: PilotRunMode = "plan_only";
  let remainder = value;
  if (value.startsWith("--run ")) {
    runMode = "auto_run";
    remainder = value.slice("--run ".length);
  } else if (value.startsWith("--draft ")) {
    remainder = value.slice("--draft ".length);
  } else if (value.startsWith("--preview ")) {
    remainder = value.slice("--preview ".length);
  }

  return {
    action: "process",
    runMode,
    mode: legacyModeForRunMode(runMode),
    rawInput: remainder.trim(),
  };
}
