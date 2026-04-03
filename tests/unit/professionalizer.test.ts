import { describe, expect, it } from "vitest";
import { professionalizeCommand } from "../../src/professionalizer/professionalize.js";
import { buildProfessionalizerPrompt } from "../../src/professionalizer/prompt.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { PilotPluginConfig } from "../../src/config/schema.js";
import type { SessionContextBundle } from "../../src/contracts/context.js";
import type { RiskAssessment } from "../../src/contracts/risk.js";

function createApi(): OpenClawPluginApi {
  return {
    id: "command-pilot",
    name: "Command Pilot",
    source: "test",
    registrationMode: "full",
    config: { agents: { defaults: {} } } as OpenClawPluginApi["config"],
    runtime: {
      agent: {
        session: {
          resolveSessionFilePath: () => "/tmp/session.json"
        }
      }
    } as unknown as OpenClawPluginApi["runtime"],
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    registerTool: () => undefined,
    registerHook: () => undefined,
    registerHttpRoute: () => undefined,
    registerChannel: () => undefined,
    registerGatewayMethod: () => undefined,
    registerCli: () => undefined,
    registerService: () => undefined,
    registerCliBackend: () => undefined,
    registerProvider: () => undefined,
    registerSpeechProvider: () => undefined,
    registerMediaUnderstandingProvider: () => undefined,
    registerImageGenerationProvider: () => undefined,
    registerWebSearchProvider: () => undefined,
    registerInteractiveHandler: () => undefined,
    onConversationBindingResolved: () => undefined,
    registerCommand: () => undefined,
    registerContextEngine: () => undefined,
    registerMemoryPromptSection: () => undefined,
    registerMemoryFlushPlan: () => undefined,
    registerMemoryRuntime: () => undefined,
    registerMemoryEmbeddingProvider: () => undefined,
    resolvePath: (input: string) => input,
    on: () => undefined
  } as unknown as OpenClawPluginApi;
}

const config: PilotPluginConfig = {
  defaultMode: "preview",
  recentTurns: 8,
  maxHistoryMessages: 12,
  allowAutoRunUpTo: "low",
  standingOrders: ["先审计再改", "不要动后端"],
  professionalizer: {
    thinking: "low",
    temperature: 0.2,
    maxTokens: 800,
    timeoutMs: 30000,
    forceHeuristicFallback: true
  },
  executor: {
    strategy: "session-subagent",
    waitTimeoutMs: 45000,
    deliver: false
  },
  confirmations: {
    ttlMs: 3600000
  }
};

const lowRisk: RiskAssessment = {
  level: "low",
  action: "allow",
  needConfirmation: false,
  reasons: [],
  matchedRuleIds: []
};

const highRisk: RiskAssessment = {
  level: "high",
  action: "confirm",
  needConfirmation: true,
  reasons: ["cleanup requires confirmation"],
  matchedRuleIds: ["cleanup"]
};

const sampleContext: SessionContextBundle = {
  sessionKey: "agent:main:webchat:dm:user-123",
  sessionId: "agent:main:webchat:dm:user-123",
  channel: "webchat",
  senderId: "user-123",
  accountId: "default",
  threadId: 1,
  recentMessages: [
    { role: "user", content: "上次我们已经确认页面要用 linear 风格。"},
    { role: "assistant", content: "明白，我会先审计再改。" }
  ],
  standingOrders: ["先审计再改", "不要动后端"],
  sessionSummary: "user: 上次我们已经确认页面要用 linear 风格。\nassistant: 明白，我会先审计再改。"
};

describe("professionalizer", () => {
  it("builds a stable prompt that includes history and standing orders", () => {
    const prompt = buildProfessionalizerPrompt({
      rawCommand: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
      mode: "draft",
      context: sampleContext
    });

    expect(prompt).toContain("Standing rules:");
    expect(prompt).toContain("先审计再改");
    expect(prompt).toContain("Recent conversation summary:");
    expect(prompt).toContain("把 OCAX 首页和 roles 页统一成 linear 风格");
  });

  it("professionalizes a low-risk UI redesign request without forcing confirmation", async () => {
    const result = await professionalizeCommand({
      api: createApi(),
      parsed: {
        kind: "execute",
        mode: "preview",
        rawInput: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
        userText: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端"
      },
      context: sampleContext,
      risk: lowRisk,
      config
    });

    expect(result.original_input).toContain("linear 风格");
    expect(result.constraints).toEqual(expect.arrayContaining(["先审计再改", "不要动后端"]));
    expect(result.need_confirmation).toBe(false);
    expect(result.risk_level).toBe("low");
    expect(result.execution_hints.requiresAuditFirst).toBe(true);
  });

  it("turns cleanup into a staged plan that waits for confirmation", async () => {
    const result = await professionalizeCommand({
      api: createApi(),
      parsed: {
        kind: "execute",
        mode: "run",
        rawInput: "帮我把 OCAX 目录里没用的旧文件都清理掉",
        userText: "帮我把 OCAX 目录里没用的旧文件都清理掉"
      },
      context: { ...sampleContext, channel: "telegram" },
      risk: highRisk,
      config
    });

    expect(result.need_confirmation).toBe(true);
    expect(result.risk_level).toBe("high");
    expect(result.optimized_instruction).toContain("confirm");
    expect(result.actionable_steps[1]?.step).toMatch(/confirmation/);
  });
});
