import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RISK_POLICY } from "./defaults.js";
import type { RiskPolicy } from "../domain/types.js";
import { safeJsonParse } from "../utils/text.js";

export async function loadRiskPolicy(
  policyPath: string | undefined,
  workspacePath: string,
): Promise<RiskPolicy> {
  if (!policyPath) {
    return DEFAULT_RISK_POLICY;
  }

  const resolvedPath = path.isAbsolute(policyPath)
    ? policyPath
    : path.resolve(workspacePath, policyPath);
  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    return safeJsonParse<RiskPolicy>(raw) ?? DEFAULT_RISK_POLICY;
  } catch {
    return DEFAULT_RISK_POLICY;
  }
}
