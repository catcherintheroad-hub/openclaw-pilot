import { describe, expect, it } from "vitest";
import { parsePilotCommand } from "../../src/openclaw/commandRegistration.js";

describe("parsePilotCommand", () => {
  it("parses draft mode and preserves the user command body", () => {
    const parsed = parsePilotCommand("--draft 把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端");

    expect(parsed).toEqual({
      kind: "execute",
      mode: "draft",
      rawInput: "--draft 把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
      userText: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端"
    });
  });

  it("parses confirmation and cancellation flows", () => {
    expect(parsePilotCommand("confirm a1b2c3")).toEqual({
      kind: "confirm",
      approvalId: "a1b2c3"
    });

    expect(parsePilotCommand("cancel deadbeef")).toEqual({
      kind: "cancel",
      approvalId: "deadbeef"
    });
  });

  it("returns help when the command body is empty", () => {
    expect(parsePilotCommand("")).toEqual({ kind: "help" });
    expect(parsePilotCommand("   ")).toEqual({ kind: "help" });
  });
});
