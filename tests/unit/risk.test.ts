import { describe, expect, it } from "vitest";
import { classifyRisk } from "../../src/risk/classifier.js";
import { canAutoRun } from "../../src/risk/gating.js";
import type { RiskPolicyConfig } from "../../src/config/schema.js";

const policy: RiskPolicyConfig = {
  version: "1",
  defaultUnknownAction: "confirm",
  rules: [
    {
      id: "cleanup",
      description: "盘点、删除、清理旧文件属于中高风险，需要先确认。",
      riskLevel: "high",
      defaultAction: "confirm",
      keywords: ["删除", "清理", "旧文件", "remove", "delete"]
    },
    {
      id: "git-remote",
      description: "git push、force push、远程配置变更必须确认。",
      riskLevel: "critical",
      defaultAction: "confirm",
      keywords: ["git push", "force push", "remote set-url", "远程", "主分支"]
    }
  ]
};

describe("risk classification", () => {
  it("keeps UI/product redesign requests low risk by default", () => {
    const risk = classifyRisk("把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端", policy);

    expect(risk.level).toBe("low");
    expect(risk.needConfirmation).toBe(false);
    expect(risk.action).toBe("allow");
  });

  it("forces cleanup requests into confirm-before-delete mode", () => {
    const risk = classifyRisk("帮我把 OCAX 目录里没用的旧文件都清理掉", policy);

    expect(risk.level).toBe("high");
    expect(risk.needConfirmation).toBe(true);
    expect(risk.action).toBe("confirm");
    expect(risk.reasons).toContain("盘点、删除、清理旧文件属于中高风险，需要先确认。");
  });

  it("blocks direct git push to main without confirmation", () => {
    const risk = classifyRisk("帮我把当前项目直接推到远程主分支", policy);

    expect(risk.level).toBe("critical");
    expect(risk.needConfirmation).toBe(true);
    expect(
      canAutoRun(risk, {
        defaultMode: "preview",
        recentTurns: 8,
        maxHistoryMessages: 12,
        allowAutoRunUpTo: "low",
        standingOrders: [],
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
      })
    ).toBe(false);
  });
});
