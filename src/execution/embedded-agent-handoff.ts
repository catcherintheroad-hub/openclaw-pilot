import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { ExecutionResult, ProfessionalizationResult, ResolvedCommandPilotConfig } from "../domain/types.js";
import { isGitTask, registerExecutionPolicy, unregisterExecutionPolicy } from "./runtime-guards.js";
import { collectAssistantText } from "../utils/run-result.js";

export async function executeOptimizedInstruction(params: {
  api: OpenClawPluginApi;
  config: ResolvedCommandPilotConfig;
  result: ProfessionalizationResult;
  contextSummary: string[];
  originalInput?: string;
  allowMutatingGit?: boolean;
  repoHasAutopushHook?: boolean;
}): Promise<ExecutionResult> {
  const workspaceDir = params.config.workspacePath;
  const sessionId = `command-pilot-auto-run-${Date.now()}`;
  const runId = sessionId;
  const sessionFile = path.join(workspaceDir, `.command-pilot-auto-run-${Date.now()}.jsonl`);
  const prompt = [
    "You are executing a Command Pilot auto_run stage.",
    "Follow the detailed executor prompt exactly.",
    "Honor constraints, scope boundaries, validation checks, workspace hygiene, and stop conditions.",
    "If context is incomplete, state assumptions before acting.",
    params.allowMutatingGit ? "" : "Hard rule: do not run git commit, amend, rebase, merge, or push. If version-control mutation seems necessary, stop and report instead.",
    params.repoHasAutopushHook ? "Repository note: post-commit autopush behavior was detected, so commit must be treated as a remote write." : "",
    "",
    "Context summary:",
    ...params.contextSummary,
    "",
    "Task objective:",
    params.result.task_objective,
    "",
    "Executor prompt:",
    params.result.executor_prompt,
    "",
    "Compact optimized instruction:",
    params.result.optimized_instruction,
  ].join("\n");

  registerExecutionPolicy({
    runId,
    workspacePath: workspaceDir,
    input: params.originalInput ?? params.result.original_input,
    runMode: "auto_run",
    isGitTask: isGitTask(params.originalInput ?? params.result.original_input, params.result),
    repoHasAutopushHook: params.repoHasAutopushHook ?? false,
    allowMutatingGit: params.allowMutatingGit ?? false,
    handoffPromptSource: "executor_prompt",
  });

  try {
    const runResult = await params.api.runtime.agent.runEmbeddedPiAgent({
      sessionId,
      runId,
      sessionFile,
      workspaceDir,
      config: params.api.config,
      prompt,
      timeoutMs: params.config.execution.timeoutMs,
    });
    const rawText = collectAssistantText(runResult);
    return {
      status: "completed",
      summary: rawText || "Execution completed with no textual summary returned.",
      rawText,
      handoffPromptSource: "executor_prompt",
      gateDecision: "allowed",
    };
  } catch (error) {
    return {
      status: "failed",
      summary: `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
      handoffPromptSource: "executor_prompt",
      gateDecision: "allowed",
    };
  } finally {
    unregisterExecutionPolicy(runId);
  }
}
