import { z } from "zod";

export const riskRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  defaultAction: z.enum(["allow", "confirm", "block"]),
  keywords: z.array(z.string().min(1)).default([])
});

export const pluginConfigSchema = z.object({
  defaultMode: z.enum(["preview", "draft", "run"]).default("preview"),
  recentTurns: z.number().int().min(1).max(30).default(8),
  maxHistoryMessages: z.number().int().min(1).max(50).default(12),
  allowAutoRunUpTo: z.enum(["low", "medium", "high", "critical"]).default("low"),
  standingOrders: z.array(z.string()).default([]),
  professionalizer: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    thinking: z.enum(["minimal", "low", "medium", "high", "xhigh"]).default("low"),
    temperature: z.number().min(0).max(2).default(0.2),
    maxTokens: z.number().int().min(200).max(4000).default(1200),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000),
    forceHeuristicFallback: z.boolean().default(false)
  }).default({}),
  executor: z.object({
    strategy: z.enum(["session-subagent", "embedded-fallback"]).default("session-subagent"),
    waitTimeoutMs: z.number().int().min(1000).max(120000).default(45000),
    deliver: z.boolean().default(false)
  }).default({}),
  confirmations: z.object({
    ttlMs: z.number().int().min(60000).max(86400000).default(3600000)
  }).default({})
});

export type PilotPluginConfig = z.infer<typeof pluginConfigSchema>;

export const riskPolicySchema = z.object({
  version: z.string().default("1"),
  defaultUnknownAction: z.enum(["confirm"]).default("confirm"),
  rules: z.array(riskRuleSchema).default([])
});

export type RiskPolicyConfig = z.infer<typeof riskPolicySchema>;
