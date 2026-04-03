import fs from "node:fs";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { pluginConfigSchema, riskPolicySchema, type PilotPluginConfig, type RiskPolicyConfig } from "./schema.js";

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadPluginConfig(api: OpenClawPluginApi): PilotPluginConfig {
  return pluginConfigSchema.parse(api.pluginConfig ?? {});
}

export function loadRiskPolicy(api: OpenClawPluginApi): RiskPolicyConfig {
  const root = api.rootDir ?? process.cwd();
  const filePath = path.join(root, "config", "risk-policy.json");
  return riskPolicySchema.parse(readJsonFile(filePath, { version: "1", rules: [] }));
}
