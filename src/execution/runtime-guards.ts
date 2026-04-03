import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EffectiveRiskDecision, ProfessionalizationResult, RiskLevel } from "../domain/types.js";

const execFileAsync = promisify(execFile);

export type ExecutionPolicy = {
  runId: string;
  workspacePath: string;
  input: string;
  runMode: "auto_run";
  isGitTask: boolean;
  repoHasAutopushHook: boolean;
  allowMutatingGit: boolean;
  handoffPromptSource: "executor_prompt";
};

export type ExecutionGuardAssessment = {
  risk: EffectiveRiskDecision;
  overlapFiles: string[];
  repoHasAutopushHook: boolean;
  isGitTask: boolean;
  handoffPromptSource: "executor_prompt";
};

const activePolicies = new Map<string, ExecutionPolicy>();
const RISK_ORDER: RiskLevel[] = ["low", "medium-low", "medium", "medium-high", "high"];

export function registerExecutionPolicy(policy: ExecutionPolicy): void {
  activePolicies.set(policy.runId, policy);
}

export function unregisterExecutionPolicy(runId: string): void {
  activePolicies.delete(runId);
}

export function findExecutionPolicy(runId: string | undefined): ExecutionPolicy | undefined {
  return runId ? activePolicies.get(runId) : undefined;
}

export function extractToolParamsText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => extractToolParamsText(entry)).join("\n");
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return Object.values(value as Record<string, unknown>)
    .map((entry) => extractToolParamsText(entry))
    .join("\n");
}

function maxRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(left) >= RISK_ORDER.indexOf(right) ? left : right;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function getDirtyFiles(workspacePath: string): Promise<string[]> {
  const output = await runGit(["status", "--porcelain"], workspacePath);
  if (!output) {
    return [];
  }
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const renamed = line.includes("->") ? line.split("->").at(-1) : line.slice(3);
      return renamed?.trim() ?? "";
    })
    .filter(Boolean);
}

async function hasAutopushHook(workspacePath: string): Promise<boolean> {
  const hookPath = await runGit(["rev-parse", "--git-path", "hooks/post-commit"], workspacePath);
  if (!hookPath) {
    return false;
  }
  const resolved = path.isAbsolute(hookPath) ? hookPath : path.resolve(workspacePath, hookPath);
  try {
    const content = await fs.readFile(resolved, "utf8");
    return /\bgit\s+push\b|\bautopush\b/i.test(content);
  } catch {
    return false;
  }
}

function inferTargetFileCandidates(result: ProfessionalizationResult): string[] {
  const combined = [
    ...result.target_files_or_areas,
    ...result.in_scope,
    result.executor_prompt,
    result.task_translation,
  ].join("\n");
  const explicit = combined.match(/\b[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+\b/g) ?? [];
  const candidates = new Set(explicit);
  if (/homepage|home page|首页/i.test(combined)) {
    candidates.add("app/page.tsx");
  }
  if (/\broles?\b/i.test(combined)) {
    candidates.add("app/roles/page.tsx");
  }
  if (/\bcaller\b/i.test(combined)) {
    candidates.add("app/caller/page.tsx");
  }
  if (/\bnode\b/i.test(combined)) {
    candidates.add("app/node/page.tsx");
  }
  if (/\bglobals\.css\b|css|style|typography|spacing|cards/i.test(combined)) {
    candidates.add("app/globals.css");
  }
  return Array.from(candidates);
}

function findDirtyOverlap(dirtyFiles: string[], targetCandidates: string[]): string[] {
  const normalizedDirty = dirtyFiles.map((entry) => entry.replace(/^\.\//, ""));
  return normalizedDirty.filter((dirty) =>
    targetCandidates.some((candidate) => {
      const normalizedCandidate = candidate.replace(/^\.\//, "");
      return dirty === normalizedCandidate || dirty.includes(normalizedCandidate) || normalizedCandidate.includes(dirty);
    }),
  );
}

export function isGitTask(input: string, result: ProfessionalizationResult): boolean {
  return /\b(git|push|branch|remote|origin|commit|rebase|merge|version[- ]control)\b|主分支|远程/.test(
    `${input}\n${result.task_translation}\n${result.executor_prompt}`,
  );
}

export async function assessExecutionGuards(params: {
  workspacePath: string;
  input: string;
  risk: EffectiveRiskDecision;
  result: ProfessionalizationResult;
}): Promise<ExecutionGuardAssessment> {
  const dirtyFiles = await getDirtyFiles(params.workspacePath);
  const targetCandidates = inferTargetFileCandidates(params.result);
  const overlapFiles = findDirtyOverlap(dirtyFiles, targetCandidates);
  const repoHasAutopushHook = await hasAutopushHook(params.workspacePath);
  const gitTask = isGitTask(params.input, params.result);

  let risk: EffectiveRiskDecision = { ...params.risk, reasons: [...params.risk.reasons] };
  if (overlapFiles.length > 0) {
    risk = {
      ...risk,
      level: maxRisk(risk.level, "medium-high"),
      needConfirmation: true,
      reasons: Array.from(new Set([...risk.reasons, `Dirty target overlap: ${overlapFiles.join(", ")}`])),
      transformedInstruction: [
        "Stop before writing any files.",
        `First inventory the dirty target overlap and explain the impact: ${overlapFiles.join(", ")}.`,
        "Do not proceed until the user confirms how to handle those existing modifications.",
        "",
        params.risk.transformedInstruction ?? params.result.executor_prompt,
      ].join("\n"),
    };
  }
  if (repoHasAutopushHook && !gitTask) {
    risk = {
      ...risk,
      level: maxRisk(risk.level, "medium-high"),
      needConfirmation: true,
      reasons: Array.from(new Set([...risk.reasons, "Repository autopush hook detected; commit is treated as remote write."])),
    };
  }

  return {
    risk,
    overlapFiles,
    repoHasAutopushHook,
    isGitTask: gitTask,
    handoffPromptSource: "executor_prompt",
  };
}

export function blockReasonForToolCall(policy: ExecutionPolicy, toolName: string, params: Record<string, unknown>): string | undefined {
  const toolText = `${toolName}\n${extractToolParamsText(params)}`;
  const mutatingGitAction =
    /\bgit\s+commit\b|\bgit\s+commit\s+--amend\b|\bgit\s+amend\b|\bgit\s+rebase\b|\bgit\s+merge\b|\bgit\s+push\b/i.test(toolText);
  if (!mutatingGitAction) {
    return undefined;
  }
  if (!policy.isGitTask) {
    return "Command Pilot blocked a mutating git action because this is not an explicit git/version-control task.";
  }
  if (policy.repoHasAutopushHook && /\bgit\s+commit\b|\bgit\s+commit\s+--amend\b|\bgit\s+amend\b/i.test(toolText)) {
    return "Command Pilot blocked commit/amend because this repository appears to auto-push after commit, so commit is treated as a remote write.";
  }
  if (!policy.allowMutatingGit) {
    return "Command Pilot blocked a mutating git action because this run was not cleared for remote/version-control writes.";
  }
  return undefined;
}
