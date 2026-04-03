import { describe, expect, it } from "vitest";
import { parsePilotCommand } from "../src/orchestration/command-parser.js";

describe("command parser", () => {
  it("parses plan_only by default", () => {
    expect(parsePilotCommand("fix docs")).toEqual({
      action: "process",
      runMode: "plan_only",
      mode: "preview",
      rawInput: "fix docs",
    });
  });

  it("parses explicit auto_run", () => {
    expect(parsePilotCommand("--run fix docs")).toEqual({
      action: "process",
      runMode: "auto_run",
      mode: "run",
      rawInput: "fix docs",
    });
  });

  it("parses confirm for auto_run approvals", () => {
    expect(parsePilotCommand("confirm pilot-123")).toEqual({
      action: "confirm",
      runMode: "auto_run",
      mode: "run",
      rawInput: "",
      pilotId: "pilot-123",
      approvalId: "pilot-123",
    });
  });

  it("parses next with feedback tail", () => {
    expect(parsePilotCommand("next pilot-123 + blocked on missing token")).toEqual({
      action: "next",
      runMode: "plan_only",
      mode: "preview",
      rawInput: "",
      pilotId: "pilot-123",
      feedback: "blocked on missing token",
    });
  });

  it("parses status", () => {
    expect(parsePilotCommand("status pilot-123")).toEqual({
      action: "status",
      runMode: "plan_only",
      mode: "preview",
      rawInput: "",
      pilotId: "pilot-123",
      approvalId: "pilot-123",
    });
  });
});
