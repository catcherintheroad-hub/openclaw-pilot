import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { buildContextSummary } from "../context/context-sanitizer.js";
import type {
  GatheredContext,
  PilotOutputLanguage,
  ProfessionalizationResult,
  ResolvedCommandPilotConfig,
} from "../domain/types.js";
import { PROFESSIONALIZER_JSON_SCHEMA } from "./schema.js";
import { buildProfessionalizerPrompt } from "./prompt.js";
import { detectPilotOutputLanguage, isChinesePilotOutput } from "../utils/language.js";

const AjvCtor = Ajv as unknown as typeof import("ajv").default;
const ajv = new AjvCtor({ allErrors: true, strict: false });
const validateProfessionalization = ajv.compile(PROFESSIONALIZER_JSON_SCHEMA);
const VALID_EXECUTION_MODES = new Set(["draft", "preview", "run"]);
const VALID_RUN_MODES = new Set(["plan_only", "auto_run"]);
const VALID_RISK_LEVELS = new Set(["low", "medium-low", "medium", "medium-high", "high"]);

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function extractJsonObjectCandidate(value: string): string {
  const stripped = stripCodeFences(value);
  const firstBrace = stripped.indexOf("{");
  if (firstBrace === -1) {
    return stripped.trim();
  }
  const lastBrace = stripped.lastIndexOf("}");
  if (lastBrace >= firstBrace) {
    return stripped.slice(firstBrace, lastBrace + 1).trim();
  }
  return stripped.slice(firstBrace).trim();
}

function stripTrailingDanglingComma(value: string): string {
  return value.replace(/,\s*$/, "");
}

function repairTruncatedJsonObject(value: string): string {
  const input = stripTrailingDanglingComma(extractJsonObjectCandidate(value));
  let output = "";
  const closers: string[] = [];
  let inString = false;
  let escaping = false;

  for (const char of input) {
    output += char;
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      closers.push("}");
    } else if (char === "[") {
      closers.push("]");
    } else if ((char === "}" || char === "]") && closers.length > 0) {
      const expected = closers[closers.length - 1];
      if (char === expected) {
        closers.pop();
      }
    }
  }

  let repaired = stripTrailingDanglingComma(output.trimEnd());
  if (inString) {
    repaired += "\"";
  }
  while (closers.length > 0) {
    repaired = stripTrailingDanglingComma(repaired);
    repaired += closers.pop();
  }
  return repaired.trim();
}

function isLikelyTruncatedJsonInput(value: string): boolean {
  const input = extractJsonObjectCandidate(value);
  const closers: string[] = [];
  let inString = false;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      closers.push("}");
    } else if (char === "[") {
      closers.push("]");
    } else if ((char === "}" || char === "]") && closers.length > 0) {
      const expected = closers[closers.length - 1];
      if (char === expected) {
        closers.pop();
      }
    }
  }

  return inString || closers.length > 0;
}

function isLikelyTruncatedJsonError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Unexpected end of JSON input|unterminated string/i.test(message);
}

function isBoundedSyntaxRecoveryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Expected ',' or '\]' after array element|Expected ',' or '\}' after property value|Expected ',' or '\}' after property-value pair|Expected ',' or '\]' after array element in JSON/i.test(message);
}

function repairMissingCommasInJson(value: string): string {
  const input = extractJsonObjectCandidate(value);
  let output = "";
  const containerStack: Array<"object" | "array"> = [];
  let inString = false;
  let escaping = false;
  let expectingValue = false;
  let pendingCommaEligible = false;

  const skipWhitespaceFrom = (start: number): number => {
    let index = start;
    while (index < input.length && /\s/.test(input[index]!)) {
      index += 1;
    }
    return index;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;

    if (!inString) {
      const nextNonWhitespaceIndex = skipWhitespaceFrom(index);
      if (
        pendingCommaEligible
        && nextNonWhitespaceIndex === index
        && (
          (
            containerStack[containerStack.length - 1] === "array"
            && (char === "\"" || char === "{" || char === "[" || char === "t" || char === "f" || char === "n" || char === "-" || /\d/.test(char))
          )
          || (
            containerStack[containerStack.length - 1] === "object"
            && char === "\""
          )
        )
      ) {
        output += ",";
        pendingCommaEligible = false;
      }
    }

    output += char;

    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      if (
        !inString
        && (containerStack[containerStack.length - 1] === "array" || containerStack[containerStack.length - 1] === "object")
        && expectingValue
      ) {
        expectingValue = false;
        pendingCommaEligible = true;
      }
      continue;
    }
    if (inString) {
      continue;
    }

    if (char === "{") {
      containerStack.push("object");
      expectingValue = false;
      pendingCommaEligible = false;
      continue;
    }
    if (char === "[") {
      containerStack.push("array");
      expectingValue = true;
      pendingCommaEligible = false;
      continue;
    }
    if (char === "}" || char === "]") {
      containerStack.pop();
      expectingValue = false;
      pendingCommaEligible = true;
      continue;
    }
    if (char === ":") {
      expectingValue = true;
      pendingCommaEligible = false;
      continue;
    }
    if (char === ",") {
      expectingValue = containerStack[containerStack.length - 1] === "array";
      pendingCommaEligible = false;
      continue;
    }
    if (/\s/.test(char)) {
      continue;
    }
    if (
      (containerStack[containerStack.length - 1] === "array" || containerStack[containerStack.length - 1] === "object")
      && expectingValue
    ) {
      const literalStart = input.slice(index);
      if (/^(true|false|null|-?\d)/.test(literalStart)) {
        expectingValue = false;
        pendingCommaEligible = true;
      }
    }
  }

  return output;
}

function parseProfessionalizerJson(rawText: string): { parsed: unknown; syntaxRecovered: boolean } {
  const directCandidate = extractJsonObjectCandidate(rawText);
  try {
    return {
      parsed: JSON.parse(directCandidate),
      syntaxRecovered: false,
    };
  } catch (error) {
    if (isBoundedSyntaxRecoveryError(error)) {
      try {
        const repairedCandidate = repairMissingCommasInJson(rawText);
        return {
          parsed: JSON.parse(repairedCandidate),
          syntaxRecovered: true,
        };
      } catch (syntaxRecoveryError) {
        if (!isLikelyTruncatedJsonError(syntaxRecoveryError) && !isLikelyTruncatedJsonInput(rawText)) {
          throw syntaxRecoveryError;
        }
      }
    }
    if (isLikelyTruncatedJsonError(error) || isLikelyTruncatedJsonInput(rawText)) {
      const repairedCandidate = repairTruncatedJsonObject(rawText);
      return {
        parsed: JSON.parse(repairedCandidate),
        syntaxRecovered: true,
      };
    }
    throw error;
  }
}

export const __structuredLlmInternals = {
  parseProfessionalizerJson,
  isRetryableProfessionalizerError,
  isAuthSkippedProfessionalizerError,
  isBoundedSyntaxRecoveryError,
  resolveProfessionalizerSessionDir,
};

function collectText(payloads: Array<{ text?: string; isError?: boolean }> | undefined): string {
  return (payloads ?? [])
    .filter((entry) => !entry.isError && typeof entry.text === "string")
    .map((entry) => entry.text ?? "")
    .join("\n")
    .trim();
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function toPilotRunMode(mode: "draft" | "preview" | "run"): "plan_only" | "auto_run" {
  return mode === "run" ? "auto_run" : "plan_only";
}

function localizeText(language: PilotOutputLanguage, zh: string, en: string): string {
  return isChinesePilotOutput(language) ? zh : en;
}

function buildFeedbackContractEntries(language: PilotOutputLanguage): string[] {
  if (isChinesePilotOutput(language)) {
    return [
      "状态（done | blocked | needs_input | failed）",
      "摘要：",
      "已完成内容：",
      "产出物：",
      "修改文件：",
      "验证结果：",
      "阻塞项：",
      "下一步建议：",
    ];
  }
  return [
    "STATUS",
    "SUMMARY",
    "WHAT_WAS_DONE",
    "ARTIFACTS",
    "FILES_CHANGED",
    "VALIDATION_RESULT",
    "BLOCKERS",
    "NEXT_STEP_SUGGESTION",
  ];
}

function buildGeneratedCommand(params: {
  language: PilotOutputLanguage;
  projectGoal: string;
  stageName: string;
  stageObjective: string;
  whyThisStageNow: string;
  contextSummary: string[];
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
  executionPlan: string[];
  deliverables: string[];
  validationChecks: string[];
  stopConditions: string[];
}): string {
  const renderList = (values: string[], emptyValue = "(none)") =>
    values.length > 0
      ? values.map((entry) => `- ${entry}`).join("\n")
      : `- ${isChinesePilotOutput(params.language) ? "（无）" : emptyValue}`;

  return [
    "[OPENCLAW_EXECUTION_PACKET v1]",
    "",
    localizeText(params.language, "角色：", "ROLE:"),
    localizeText(params.language, "你是 OpenClaw 执行代理。你的职责是只完成当前阶段目标，不擅自扩展到下一阶段。", "You are the OpenClaw execution agent. Complete only the current stage objective and do not expand into the next stage on your own."),
    "",
    localizeText(params.language, "项目：", "PROJECT:"),
    params.projectGoal,
    "",
    localizeText(params.language, "阶段：", "STAGE:"),
    params.stageName,
    "",
    localizeText(params.language, "阶段目标：", "STAGE_OBJECTIVE:"),
    params.stageObjective,
    "",
    localizeText(params.language, "为什么现在先做这一阶段：", "WHY_THIS_STAGE_NOW:"),
    params.whyThisStageNow,
    "",
    localizeText(params.language, "已知上下文：", "KNOWN_CONTEXT:"),
    renderList(params.contextSummary),
    "",
    localizeText(params.language, "本轮范围内：", "IN_SCOPE:"),
    renderList(params.inScope),
    "",
    localizeText(params.language, "本轮范围外：", "OUT_OF_SCOPE:"),
    renderList(params.outOfScope),
    "",
    localizeText(params.language, "约束条件：", "CONSTRAINTS:"),
    renderList(params.constraints),
    "",
    localizeText(params.language, "执行计划：", "EXECUTION_PLAN:"),
    renderList(params.executionPlan),
    "",
    localizeText(params.language, "交付物：", "DELIVERABLES:"),
    renderList(params.deliverables),
    "",
    localizeText(params.language, "验证方式：", "VALIDATION:"),
    renderList(params.validationChecks),
    "",
    localizeText(params.language, "停止条件：", "STOP_CONDITIONS:"),
    renderList([
      ...params.stopConditions,
      localizeText(params.language, "遇到需要更高权限或高风险写操作时停止", "Stop if higher privileges or high-risk writes are required."),
      localizeText(params.language, "缺少关键输入时停止", "Stop if key inputs are missing."),
      localizeText(params.language, "超出本轮范围时停止", "Stop if the work expands beyond the approved scope."),
    ]),
    "",
    localizeText(params.language, "不要做的事：", "DO_NOT:"),
    renderList([
      localizeText(params.language, "不要擅自改写项目目标", "Do not rewrite the project goal."),
      localizeText(params.language, "不要进入下一阶段", "Do not move into the next stage."),
      localizeText(params.language, "不要做未明确授权的危险操作", "Do not perform dangerous actions without explicit authorization."),
      localizeText(params.language, "不要把“建议”伪装成“已完成”", "Do not present recommendations as if they were completed work."),
    ]),
    "",
    localizeText(params.language, "回传格式：", "RETURN_FORMAT:"),
    renderList(buildFeedbackContractEntries(params.language)),
    "",
    "[END_OPENCLAW_EXECUTION_PACKET]",
  ].join("\n");
}

function inferTaskShape(input: string, context: GatheredContext): {
  taskObjective: string;
  taskTranslation: string;
  inScope: string[];
  outOfScope: string[];
  targetFilesOrAreas: string[];
  executionPlan: string[];
  validationChecks: string[];
  workspaceHygiene: string[];
  stopConditions: string[];
  expectedDeliverables: string[];
  executorPrompt: string;
} {
  const normalizedInput = input.trim().replace(/\s+/g, " ");
  const language = detectPilotOutputLanguage(input);
  const contextSummary = summarizeContextForDisplay(context, input);
  const isUiTask = /\b(ui|ux|homepage|home page|roles?\b|layout|style|linear|frontend|design)\b|首页|页面|风格/.test(normalizedInput);
  const isGitTask = /\b(push|branch|remote|origin|force push|git)\b|主分支|远程/.test(normalizedInput);
  const isCleanupTask = /\b(cleanup|clean up|delete|remove)\b|清理|删除|删掉/.test(normalizedInput);
  const constraints = normalizedInput
    .split(/[，,；;。]/)
    .map((entry) => entry.trim())
    .filter((entry) => /不要|先|only|without|audit|审计|report|确认|后端|backend/i.test(entry));

  if (isUiTask) {
    const inScope = dedupeStrings(isChinesePilotOutput(language)
      ? ["OCAX 首页", "roles 页面", "共享前端样式层", "修改前的视觉审计"]
      : ["OCAX homepage", "roles page", "shared frontend styling layers", "visual audit before edits"]);
    const outOfScope = dedupeStrings(isChinesePilotOutput(language)
      ? ["后端代码", "API 合约", "数据库或服务端改动", "无关页面"]
      : ["backend code", "API contracts", "database or server changes", "unrelated pages"]);
    const targetFilesOrAreas = dedupeStrings([
      "app/page.tsx (homepage route) and its page-level components",
      "app/node/page.tsx when it participates in the same homepage-style surface",
      "app/caller/page.tsx when it participates in the same role and entry flow styling surface",
      "roles page route and presentation components",
      "app/globals.css and shared CSS/theme tokens, layout primitives, typography, spacing, and card styles used by those pages",
    ]);
    const executionPlan = dedupeStrings(isChinesePilotOutput(language)
      ? [
          "先审计首页和 roles 页面，找出与目标 linear 风格不一致的布局、间距、字体和组件问题。",
          "只圈定实现这次统一所需的最小前端文件、样式和共享基础层，不扩散到无关区域。",
          "分阶段完成纯前端视觉统一，优先复用共享样式原语，避免一次性覆盖式改动。",
          "验证两个页面仍能正常渲染，并总结已修改内容、刻意未动范围和后续建议。",
        ]
      : [
          "Audit the homepage and roles page first to identify layout, spacing, typography, and component mismatches against the requested linear-style direction.",
          "Map the smallest set of frontend files, styles, and shared primitives needed to align both pages without expanding into unrelated areas.",
          "Implement the visual alignment in staged frontend-only edits, preferring reusable style primitives over one-off overrides.",
          "Verify both pages still render correctly and summarize what changed, what was intentionally left untouched, and any follow-up recommendations.",
        ]);
    const validationChecks = dedupeStrings(isChinesePilotOutput(language)
      ? [
          "两个页面呈现出明显更一致的 linear 风格视觉语言。",
          "没有修改后端文件、服务端逻辑或 API 合约。",
          "只变更了目标页面、组件和样式文件。",
          "更新后的页面保持布局完整，没有明显回归。",
        ]
      : [
          "Both pages follow a noticeably more consistent linear-style visual language.",
          "No backend files, server logic, or API contracts are modified.",
          "Only intended page/component/style files changed.",
          "The updated pages keep layout integrity and avoid obvious regressions.",
        ]);
    const workspaceHygiene = dedupeStrings(isChinesePilotOutput(language)
      ? [
          "把改动限制在首页、roles 页面和直接相关的共享样式原语上。",
          "先审计再改文件，避免和这次 UI 统一无关的大范围重构。",
          "即使其他路由风格不一致，也不要顺手改后端或无关页面。",
          "遇到已有脏文件时单独说明，不要混入本任务。",
        ]
      : [
          "Limit edits to the homepage, roles page, and directly related shared styling primitives.",
          "Audit before modifying files and avoid sweeping refactors unrelated to the requested UI alignment.",
          "Do not touch backend or unrelated routes even if they look stylistically inconsistent.",
          "Call out pre-existing dirty files instead of folding them into this task.",
        ]);
    const stopConditions = dedupeStrings(isChinesePilotOutput(language)
      ? [
          "如果所需视觉改动明显依赖后端或数据模型调整，就停止。",
          "如果要完成统一必须扩展成首页和 roles 页面之外的大范围设计系统重构，就停止。",
          "如果无法有把握地定位相关前端表面，就停止并说明。",
        ]
      : [
          "Stop if the requested visual change clearly requires backend or data-model changes.",
          "Stop if aligning the pages would require broad design-system refactors beyond the homepage and roles page.",
          "Stop and report if the relevant frontend surface cannot be located confidently.",
        ]);
    const expectedDeliverables = dedupeStrings(isChinesePilotOutput(language)
      ? [
          "首页和 roles 页的审计摘要",
          "收敛后的前端实施计划",
          "目标页面及样式层的纯前端改动",
          "说明已修改内容和仍在范围外内容的验证摘要",
        ]
      : [
          "Audit summary for homepage and roles page",
          "Scoped frontend implementation plan",
          "Frontend-only changes for the targeted pages and style layers",
          "Validation summary describing what changed and what stayed out of scope",
        ]);
    const executorPrompt = [
      localizeText(language, "你是当前工作区内一项前端收敛任务的执行代理。", "Act as the execution agent for a scoped frontend refinement task inside the current workspace."),
      `Task objective: ${normalizedInput}.`,
      localizeText(language, "任务翻译：把 OCAX 首页和 roles 页面统一成同一套 linear 风格前端体验，并且严格保持为纯前端工作。", "Task translation: unify the OCAX homepage and roles page so they read as part of the same linear-style frontend experience, while keeping the work strictly frontend-only."),
      `Context summary: ${contextSummary.join("; ")}.`,
      `In scope: ${inScope.join("; ")}.`,
      `Out of scope: ${outOfScope.join("; ")}.`,
      `Target files or areas: ${targetFilesOrAreas.join("; ")}.`,
      `Constraints: ${(constraints.length > 0 ? constraints : ["frontend-only", "audit before edits"]).join("; ")}.`,
      localizeText(language, "执行计划：检查当前首页、roles 页面以及任何共享同一视觉系统的 caller/node 入口表面；识别样式、间距、字体和卡片/布局不一致；选择最小必要页面与共享样式层进行修改；分阶段完成视觉统一；并验证受影响页面保持一致且没有后端漂移。", "Execution plan: inspect the current homepage, roles page, and any directly related caller/node entry surfaces that share the same visual system; identify styling, spacing, typography, and card/layout mismatches; choose the smallest page and shared-style surface that needs edits; implement the visual alignment in scoped stages; and validate that the affected pages stay coherent without backend drift."),
      `Validation checks: ${validationChecks.join("; ")}.`,
      `Workspace hygiene: ${workspaceHygiene.join("; ")}.`,
      `Stop conditions: ${stopConditions.join("; ")}.`,
      `Expected deliverables: ${expectedDeliverables.join("; ")}.`,
      localizeText(language, "优先做具体、局部的文件改动，保留现有行为；如果目标视觉方向有歧义，先说明假设再修改。", "Prefer concrete file-local changes, preserve existing behavior, and explain assumptions before editing if the intended visual direction is ambiguous."),
    ].join(" ");
    return {
      taskObjective: normalizedInput,
      taskTranslation: localizeText(language, "把高层级 UI 统一诉求翻译成面向 OCAX 首页和 roles 页的纯前端审计与实施计划。", "Translate a high-level UI alignment request into a frontend-only audit-and-implement plan for the OCAX homepage and roles page."),
      inScope,
      outOfScope,
      targetFilesOrAreas,
      executionPlan,
      validationChecks,
      workspaceHygiene,
      stopConditions,
      expectedDeliverables,
      executorPrompt,
    };
  }

  if (isGitTask || isCleanupTask) {
    const inScope = dedupeStrings([
      isGitTask ? "risk assessment for remote git mutation" : "risk assessment for destructive cleanup",
      "inventory of impacted files, branches, or remote targets",
      "confirmation-gated next steps",
    ]);
    const outOfScope = dedupeStrings([
      "silent destructive actions",
      "silent remote pushes",
      "forceful cleanup without review",
      "unapproved production-impacting operations",
    ]);
    const targetFilesOrAreas = dedupeStrings([
      isGitTask ? "current branch, remote target, and git status" : "candidate files and directories proposed for cleanup",
      "working tree state and existing uncommitted changes",
      "any configuration indicating production or shared remote impact",
    ]);
    const executionPlan = dedupeStrings([
      "Inventory the current git and workspace state before taking any side effects.",
      "Explain exactly what would be pushed, deleted, or changed, including which branch or remote is involved.",
      "Produce a confirmation-gated plan that the user can approve or reject.",
      "Only perform the risky operation after explicit confirmation and only within the reviewed scope.",
    ]);
    const validationChecks = dedupeStrings([
      "The exact risky action, target, and blast radius are clearly identified.",
      "No remote mutation or destructive cleanup happens before confirmation.",
      "The plan accounts for existing dirty workspace state and avoids unrelated changes.",
    ]);
    const workspaceHygiene = dedupeStrings([
      "Do not mutate remotes, branches, or files until the user confirms.",
      "Keep inventory and reporting separate from execution.",
      "Surface pre-existing dirty changes instead of bundling them into the risky action.",
    ]);
    const stopConditions = dedupeStrings([
      "Stop before any push, delete, overwrite, remote reconfiguration, or production-affecting action.",
      "Stop if the target branch, remote, or cleanup scope is ambiguous.",
      "Stop if the workspace contains unrelated dirty changes that raise uncertainty about blast radius.",
    ]);
    const expectedDeliverables = dedupeStrings([
      "Inventory of impacted state",
      "Risk summary with blast radius",
      "Explicit confirmation gate",
      "Execution checklist for the approved action",
    ]);
    const executorPrompt = [
      "Act as a cautious execution planner for a high-risk repository operation.",
      `Task objective: ${normalizedInput}.`,
      "Task translation: convert the user's risky request into an inventory-first, confirmation-gated procedure that makes the exact remote or destructive impact explicit before any side effects occur.",
      `Context summary: ${contextSummary.join("; ")}.`,
      `In scope: ${inScope.join("; ")}.`,
      `Out of scope: ${outOfScope.join("; ")}.`,
      `Target files or areas: ${targetFilesOrAreas.join("; ")}.`,
      `Constraints: ${(constraints.length > 0 ? constraints : ["no remote or destructive action before confirmation"]).join("; ")}.`,
      "Execution plan: inspect git status and identify the exact branch, remote, or cleanup candidates, summarize what would change and why it is risky, present a precise confirmation gate, and only after approval carry out the reviewed operation.",
      `Validation checks: ${validationChecks.join("; ")}.`,
      `Workspace hygiene: ${workspaceHygiene.join("; ")}.`,
      `Stop conditions: ${stopConditions.join("; ")}.`,
      `Expected deliverables: ${expectedDeliverables.join("; ")}.`,
      "Do not replace this with generic cautionary language; name the git, remote, or cleanup surface being evaluated and make the blast radius explicit.",
    ].join(" ");
    return {
      taskObjective: normalizedInput,
      taskTranslation: localizeText(language, "把高风险 git 或破坏性诉求翻译成先盘点、再确认、再执行的流程。", "Translate a risky git or destructive request into an inventory-first, confirmation-gated execution procedure."),
      inScope,
      outOfScope,
      targetFilesOrAreas,
      executionPlan,
      validationChecks,
      workspaceHygiene,
      stopConditions,
      expectedDeliverables,
      executorPrompt,
    };
  }

  const inScope = dedupeStrings(isChinesePilotOutput(language)
    ? ["当前请求", "直接相关的工作区区域", "收敛后的执行规划"]
    : ["current request", "directly relevant workspace areas", "scoped execution planning"]);
  const outOfScope = dedupeStrings(isChinesePilotOutput(language)
    ? ["无关文件", "意外扩散的重构", "超出本次要求的危险副作用"]
    : ["unrelated files", "surprise refactors", "unsafe side effects beyond the stated request"]);
  const targetFilesOrAreas = dedupeStrings(isChinesePilotOutput(language)
    ? ["与当前请求直接相关的文件或模块", "最近讨论所指向的当前工作区表面"]
    : ["files or modules directly related to the current request", "current workspace surface implicated by recent discussion"]);
  const executionPlan = dedupeStrings(isChinesePilotOutput(language)
    ? [
        "修改前先审计相关工作区表面。",
        "把请求翻译成满足约束条件的最小可执行实施计划。",
        "只执行收敛后的范围，并总结结果。",
      ]
    : [
        "Audit the relevant workspace surface before editing.",
        "Translate the request into the smallest concrete implementation plan that satisfies the stated constraints.",
        "Execute only the scoped work and summarize the outcome.",
      ]);
  const validationChecks = dedupeStrings(isChinesePilotOutput(language)
    ? [
        "结果符合用户请求和约束条件。",
        "无关区域保持不变。",
      ]
    : [
        "The outcome matches the user's request and constraints.",
        "Unrelated areas remain untouched.",
      ]);
  const workspaceHygiene = dedupeStrings(isChinesePilotOutput(language)
    ? [
        "把改动限制在任务相关表面。",
        "避免无关清理或重构。",
      ]
    : [
        "Keep edits local to the task surface.",
        "Avoid unrelated cleanup or refactors.",
      ]);
  const stopConditions = dedupeStrings(isChinesePilotOutput(language)
    ? [
        "如果无法有把握地识别所需工作区表面，就停止。",
        "如果请求扩展成未经批准的高风险副作用，就停止。",
      ]
    : [
        "Stop if the required workspace surface cannot be identified confidently.",
        "Stop if the request expands into risky side effects that were not approved.",
      ]);
  const expectedDeliverables = dedupeStrings(isChinesePilotOutput(language)
    ? ["收敛后的实施计划", "任务专属执行步骤", "验证摘要"]
    : ["scoped implementation plan", "task-specific execution steps", "validation summary"]);
  const executorPrompt = [
    localizeText(language, "你是当前工作区任务的执行代理。", "Act as the execution agent for the current workspace task."),
    `Task objective: ${normalizedInput}.`,
    localizeText(language, "任务翻译：把用户的自然语言请求转换成与相关工作区表面绑定的、具体且收敛的实施计划。", "Task translation: convert the user's natural-language request into a concrete scoped implementation plan tied to the relevant workspace surface."),
    `Context summary: ${contextSummary.join("; ")}.`,
    `In scope: ${inScope.join("; ")}.`,
    `Out of scope: ${outOfScope.join("; ")}.`,
    `Target files or areas: ${targetFilesOrAreas.join("; ")}.`,
    `Constraints: ${(constraints.length > 0 ? constraints : ["respect current workspace boundaries"]).join("; ")}.`,
    `Execution plan: ${executionPlan.join("; ")}.`,
    `Validation checks: ${validationChecks.join("; ")}.`,
    `Workspace hygiene: ${workspaceHygiene.join("; ")}.`,
    `Stop conditions: ${stopConditions.join("; ")}.`,
    `Expected deliverables: ${expectedDeliverables.join("; ")}.`,
  ].join(" ");
  return {
    taskObjective: normalizedInput,
    taskTranslation: localizeText(language, "把请求翻译成与当前工作区绑定的收敛执行计划。", "Translate the request into a scoped execution plan tied to the current workspace."),
    inScope,
    outOfScope,
    targetFilesOrAreas,
    executionPlan,
    validationChecks,
    workspaceHygiene,
    stopConditions,
    expectedDeliverables,
    executorPrompt,
  };
}

type ProfessionalizerCandidate = {
  provider?: string;
  model?: string;
  authProfileId?: string;
  source: string;
};

function normalizeCandidate(candidate: ProfessionalizerCandidate): ProfessionalizerCandidate | null {
  const provider = candidate.provider?.trim();
  const model = candidate.model?.trim();
  const authProfileId = candidate.authProfileId?.trim();
  if (!provider && !model && !authProfileId) {
    return null;
  }
  return {
    provider,
    model,
    authProfileId,
    source: candidate.source,
  };
}

function inferProviderCandidatesFromConfig(api: OpenClawPluginApi): ProfessionalizerCandidate[] {
  const modelsConfig = (api.config as { models?: { providers?: Record<string, unknown> } }).models;
  const providers = modelsConfig?.providers;
  if (!providers || typeof providers !== "object") {
    return [];
  }

  return Object.entries(providers)
    .map(([providerId, providerConfig]) => {
      const record = providerConfig as { models?: unknown };
      let model = "";
      if (Array.isArray(record.models)) {
        const first = record.models[0];
        model =
          typeof first === "string"
            ? first
            : typeof first === "object" && first && "id" in first && typeof first.id === "string"
              ? first.id
              : "";
      } else if (record.models && typeof record.models === "object") {
        model = Object.keys(record.models)[0] ?? "";
      }
      return normalizeCandidate({
        provider: providerId,
        model,
        source: `config:${providerId}`,
      });
    })
    .filter((entry): entry is ProfessionalizerCandidate => Boolean(entry))
    .sort((left, right) => {
      const leftAnthropic = left.provider === "anthropic" ? 1 : 0;
      const rightAnthropic = right.provider === "anthropic" ? 1 : 0;
      return leftAnthropic - rightAnthropic;
    });
}

function buildProfessionalizerCandidates(
  api: OpenClawPluginApi,
  config: ResolvedCommandPilotConfig,
): ProfessionalizerCandidate[] {
  const defaultProvider = api.runtime.agent.defaults.provider?.trim();
  const defaultModelRaw = api.runtime.agent.defaults.model?.trim();
  const defaultModel =
    defaultModelRaw && defaultModelRaw.includes("/")
      ? defaultModelRaw.split("/").slice(1).join("/")
      : defaultModelRaw;

  const configured = normalizeCandidate({
    provider: config.professionalizer.provider,
    model: config.professionalizer.model,
    authProfileId: config.professionalizer.authProfileId,
    source: "plugin-config",
  });

  const runtimeDefault = normalizeCandidate({
    provider: defaultProvider,
    model: defaultModel,
    source: "runtime-default",
  });

  const configuredFallbacks = config.professionalizer.fallbackChain
    .map((entry, index) =>
      normalizeCandidate({
        provider: entry.provider,
        model: entry.model,
        authProfileId: entry.authProfileId,
        source: `plugin-fallback-${index + 1}`,
      }),
    )
    .filter((entry): entry is ProfessionalizerCandidate => Boolean(entry));

  const configDiscovered = inferProviderCandidatesFromConfig(api);
  const autoCandidate = normalizeCandidate({
    source: "auto-unpinned",
  });

  const deduped = new Map<string, ProfessionalizerCandidate>();
  for (const candidate of [configured, runtimeDefault, ...configuredFallbacks, ...configDiscovered, autoCandidate]) {
    if (!candidate) {
      continue;
    }
    const key = JSON.stringify([
      candidate.provider ?? "",
      candidate.model ?? "",
      candidate.authProfileId ?? "",
    ]);
    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }
  const sourcePriority = (source: string): number => {
    if (source === "plugin-config") {
      return 0;
    }
    if (source === "runtime-default") {
      return 1;
    }
    if (source.startsWith("config:")) {
      return 2;
    }
    if (source.startsWith("plugin-fallback-")) {
      return 3;
    }
    return 4;
  };

  return [...deduped.values()].sort((left, right) => {
    const leftPriority = sourcePriority(left.source);
    const rightPriority = sourcePriority(right.source);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftAnthropic = left.provider === "anthropic" ? 1 : 0;
    const rightAnthropic = right.provider === "anthropic" ? 1 : 0;
    return leftAnthropic - rightAnthropic;
  });
}

function isRetryableProfessionalizerError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /429|rate[_ -]?limit|rate_limit_error|surface_error|Unexpected end of JSON input|unterminated string|Expected ',' or '}'|No API key found for provider|No available auth profile/i.test(text);
}

function isAuthSkippedProfessionalizerError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /No API key found for provider|No available auth profile/i.test(text);
}

function buildMinimalStructuredBrief(params: {
  input: string;
  mode: "draft" | "preview" | "run";
  context: GatheredContext;
  lastError?: unknown;
}): ProfessionalizationResult {
  const normalized = params.input.trim().replace(/\s+/g, " ");
  const language = detectPilotOutputLanguage(params.input);
  const lower = normalized.toLowerCase();
  const looksDestructive = /delete|remove|cleanup|clean up|清理|删除|删掉|push|force push|主分支|remote|sudo|生产/.test(lower);
  const constraints = normalized
    .split(/[，,；;。]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => /不要|先|only|without|audit|审计|report|确认|后端/i.test(entry));
  const contextSummary = summarizeContextForDisplay(params.context, params.input);
  const fallbackReason = params.lastError instanceof Error ? params.lastError.message : params.lastError ? String(params.lastError) : "fallback";
  const taskShape = inferTaskShape(params.input, params.context);
  const pilotId = `pilot-${Math.abs(hashString(normalized)).toString(36).slice(0, 8)}`;
  const runMode = toPilotRunMode(params.mode);
  const currentStageName = looksDestructive
    ? localizeText(language, "阶段 1：风险与范围界定", "Stage 1: risk and scope framing")
    : localizeText(language, "阶段 1：项目蓝图界定", "Stage 1: project framing");
  const currentStageObjective = taskShape.taskTranslation;
  const whyThisStageNow = taskShape.executionPlan[0]
    ?? localizeText(language, "先把想法编译成安全、可执行的第一阶段命令。", "Compile the idea into a safe, actionable first-stage command.");
  const successCriteria = taskShape.validationChecks;
  const keyRisks = taskShape.stopConditions;
  const generatedCommand = buildGeneratedCommand({
    language,
    projectGoal: normalized,
    stageName: currentStageName,
    stageObjective: currentStageObjective,
    whyThisStageNow,
    contextSummary,
    inScope: taskShape.inScope,
    outOfScope: taskShape.outOfScope,
    constraints,
    executionPlan: taskShape.executionPlan,
    deliverables: taskShape.expectedDeliverables,
    validationChecks: taskShape.validationChecks,
    stopConditions: taskShape.stopConditions,
  });
  return {
    original_input: params.input,
    normalized_intent: normalized,
    goal: normalized,
    project_goal: normalized,
    core_thesis: normalized,
    pilot_id: pilotId,
    current_stage_id: "stage-1",
    current_stage_name: currentStageName,
    current_stage_objective: currentStageObjective,
    why_this_stage_now: whyThisStageNow,
    scope: ["current request", "current workspace or routed session"],
    constraints,
    deliverables: looksDestructive
      ? (isChinesePilotOutput(language)
          ? ["现状盘点", "风险摘要", "需确认后才能执行的计划"]
          : ["inventory", "risk summary", "confirmation-gated execution plan"])
      : (isChinesePilotOutput(language)
          ? ["执行蓝图", "收敛计划", "交接指令"]
          : ["execution brief", "scoped plan", "handoff instruction"]),
    execution_mode: params.mode,
    run_mode: runMode,
    risk_level: looksDestructive ? "medium-high" : "low",
    need_confirmation: looksDestructive,
    success_criteria: successCriteria,
    key_risks: keyRisks,
    feedback_contract: buildFeedbackContractEntries(language),
    generated_command: generatedCommand,
    generated_command_preview: generatedCommand.slice(0, 320),
    next_command: `/pilot next ${pilotId}`,
    optimized_instruction: looksDestructive
      ? localizeText(language, `以保守方式理解这个请求。先盘点受影响文件或远程操作，总结发现，再在得到明确确认后才进行破坏性或远程修改。原始请求：${normalized}`, `Interpret the request conservatively. First inventory the affected files or remote actions, summarize findings, and wait for explicit confirmation before making destructive or remote changes. Original request: ${normalized}`)
      : localizeText(language, `结合当前会话上下文理解这个请求，保持范围收敛、遵守约束，并分阶段执行。原始请求：${normalized}`, `Interpret the request using current session context, keep scope tight, preserve constraints, and execute in staged steps. Original request: ${normalized}`),
    context_used_summary: contextSummary,
    task_objective: taskShape.taskObjective,
    task_translation: taskShape.taskTranslation,
    in_scope: taskShape.inScope,
    out_of_scope: taskShape.outOfScope,
    target_files_or_areas: taskShape.targetFilesOrAreas,
    execution_plan: taskShape.executionPlan,
    validation_checks: taskShape.validationChecks,
    workspace_hygiene: taskShape.workspaceHygiene,
    stop_conditions: taskShape.stopConditions,
    expected_deliverables: taskShape.expectedDeliverables,
    executor_prompt: taskShape.executorPrompt,
    executor_prompt_preview: taskShape.executorPrompt.slice(0, 320),
    schema_validation_ok: false,
    fallback_reason: fallbackReason,
    channel_strategy: localizeText(language, `${params.context.snapshot?.channel ?? "unknown"} 渠道的 fallback 蓝图`, `Fallback brief for ${params.context.snapshot?.channel ?? "unknown"} channel`),
    suggested_plan: looksDestructive
      ? (isChinesePilotOutput(language)
          ? ["盘点当前状态", "总结清理或推送影响", "等待确认", "只执行已批准的变更"]
          : ["Inventory current state", "Summarize cleanup/push impact", "Wait for confirmation", "Execute approved changes only"])
      : (isChinesePilotOutput(language)
          ? ["审计当前状态", "执行收敛改动", "回报结果"]
          : ["Audit current state", "Apply scoped changes", "Report outcome"]),
    risk_reasons: [localizeText(language, `LLM professionalizer 已降级为最小蓝图：${fallbackReason}`, `LLM professionalizer degraded to minimal brief: ${fallbackReason}`)],
    output_language: language,
  };
}

function summarizeContextForDisplay(context: GatheredContext, input: string): string[] {
  const summaries = new Set<string>(buildContextSummary(context));
  const normalizedInput = input.toLowerCase();

  if (/\b(push|branch|remote|deploy|production|cleanup|delete)\b/i.test(normalizedInput)) {
    summaries.add("recent repo task discussion");
  }
  if (input.trim()) {
    summaries.add("current workspace intent");
  }
  if (!/(don't|do not|不要|先|only|without|avoid|不要动|审计|确认)/i.test(normalizedInput)) {
    summaries.add("no strong prior constraints found");
  }

  return Array.from(summaries).slice(0, 4);
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function repairProfessionalizationResult(params: {
  parsed: unknown;
  input: string;
  mode: "draft" | "preview" | "run";
  context: GatheredContext;
}): { result: ProfessionalizationResult; repairedFields: string[] } {
  const record = (params.parsed && typeof params.parsed === "object" ? params.parsed : {}) as Record<string, unknown>;
  const language =
    typeof record.output_language === "string" && (record.output_language === "zh-CN" || record.output_language === "en")
      ? (record.output_language as PilotOutputLanguage)
      : detectPilotOutputLanguage(params.input);
  const fallbackContextSummary = summarizeContextForDisplay(params.context, params.input);
  const taskShape = inferTaskShape(params.input, params.context);
  const normalizedIntent = firstNonEmptyString(record.normalized_intent, record.intent, record.goal, params.input);
  const goal = firstNonEmptyString(record.goal, normalizedIntent, params.input);
  const projectGoal = firstNonEmptyString(record.project_goal, goal);
  const coreThesis = firstNonEmptyString(record.core_thesis, normalizedIntent);
  const pilotId = firstNonEmptyString(record.pilot_id, `pilot-${Math.abs(hashString(goal)).toString(36).slice(0, 8)}`);
  const currentStageId = firstNonEmptyString(record.current_stage_id, "stage-1");
  const currentStageName = firstNonEmptyString(
    record.current_stage_name,
    localizeText(language, "阶段 1：项目蓝图界定", "Stage 1: project framing"),
  );
  const currentStageObjective = firstNonEmptyString(record.current_stage_objective, taskShape.taskTranslation, goal);
  const whyThisStageNow = firstNonEmptyString(
    record.why_this_stage_now,
    taskShape.executionPlan[0],
    localizeText(language, "先把想法编译成安全可执行的命令。", "Compile the idea into a safe executable command."),
  );
  const scope = toStringArray(record.scope);
  const constraints = toStringArray(record.constraints);
  const deliverables = toStringArray(record.deliverables);
  const successCriteria = toStringArray(record.success_criteria);
  const keyRisks = toStringArray(record.key_risks);
  const feedbackContract = toStringArray(record.feedback_contract);
  const suggestedPlan = toStringArray(record.suggested_plan);
  const riskReasons = toStringArray(record.risk_reasons);
  const runMode =
    typeof record.run_mode === "string" && VALID_RUN_MODES.has(record.run_mode)
      ? (record.run_mode as ProfessionalizationResult["run_mode"])
      : toPilotRunMode(params.mode);
  const generatedCommand = firstNonEmptyString(
    record.generated_command,
    buildGeneratedCommand({
      language,
      projectGoal,
      stageName: currentStageName,
      stageObjective: currentStageObjective,
      whyThisStageNow,
      contextSummary: fallbackContextSummary,
      inScope: toStringArray(record.in_scope).length > 0 ? toStringArray(record.in_scope) : taskShape.inScope,
      outOfScope: toStringArray(record.out_of_scope).length > 0 ? toStringArray(record.out_of_scope) : taskShape.outOfScope,
      constraints,
      executionPlan: toStringArray(record.execution_plan).length > 0 ? toStringArray(record.execution_plan) : taskShape.executionPlan,
      deliverables: toStringArray(record.expected_deliverables).length > 0 ? toStringArray(record.expected_deliverables) : taskShape.expectedDeliverables,
      validationChecks: toStringArray(record.validation_checks).length > 0 ? toStringArray(record.validation_checks) : taskShape.validationChecks,
      stopConditions: toStringArray(record.stop_conditions).length > 0 ? toStringArray(record.stop_conditions) : taskShape.stopConditions,
    }),
  );
  const repairedFields: string[] = [];

  const result: ProfessionalizationResult = {
    original_input: firstNonEmptyString(record.original_input, params.input),
    normalized_intent: normalizedIntent,
    goal,
    project_goal: projectGoal,
    core_thesis: coreThesis,
    pilot_id: pilotId,
    current_stage_id: currentStageId,
    current_stage_name: currentStageName,
    current_stage_objective: currentStageObjective,
    why_this_stage_now: whyThisStageNow,
    scope: scope.length > 0 ? scope : ["current request"],
    constraints,
    deliverables: deliverables.length > 0 ? deliverables : [localizeText(language, "执行蓝图", "execution brief")],
    execution_mode:
      typeof record.execution_mode === "string" && VALID_EXECUTION_MODES.has(record.execution_mode)
        ? (record.execution_mode as ProfessionalizationResult["execution_mode"])
        : params.mode,
    run_mode: runMode,
    risk_level:
      typeof record.risk_level === "string" && VALID_RISK_LEVELS.has(record.risk_level)
        ? (record.risk_level as ProfessionalizationResult["risk_level"])
        : "low",
    need_confirmation: typeof record.need_confirmation === "boolean" ? record.need_confirmation : false,
    success_criteria: successCriteria.length > 0 ? successCriteria : taskShape.validationChecks,
    key_risks: keyRisks.length > 0 ? keyRisks : taskShape.stopConditions,
    feedback_contract: feedbackContract.length > 0 ? feedbackContract : buildFeedbackContractEntries(language),
    generated_command: generatedCommand,
    generated_command_preview: firstNonEmptyString(record.generated_command_preview, generatedCommand.slice(0, 320)),
    next_command: firstNonEmptyString(record.next_command, `/pilot next ${pilotId}`),
    optimized_instruction: firstNonEmptyString(record.optimized_instruction, goal, params.input),
    context_used_summary:
      toStringArray(record.context_used_summary).length > 0 ? toStringArray(record.context_used_summary) : fallbackContextSummary,
    task_objective: firstNonEmptyString(record.task_objective, goal, taskShape.taskObjective),
    task_translation: firstNonEmptyString(record.task_translation, taskShape.taskTranslation),
    in_scope: toStringArray(record.in_scope).length > 0 ? toStringArray(record.in_scope) : taskShape.inScope,
    out_of_scope: toStringArray(record.out_of_scope).length > 0 ? toStringArray(record.out_of_scope) : taskShape.outOfScope,
    target_files_or_areas:
      toStringArray(record.target_files_or_areas).length > 0
        ? toStringArray(record.target_files_or_areas)
        : taskShape.targetFilesOrAreas,
    execution_plan:
      toStringArray(record.execution_plan).length > 0
        ? toStringArray(record.execution_plan)
        : taskShape.executionPlan,
    validation_checks:
      toStringArray(record.validation_checks).length > 0
        ? toStringArray(record.validation_checks)
        : taskShape.validationChecks,
    workspace_hygiene:
      toStringArray(record.workspace_hygiene).length > 0
        ? toStringArray(record.workspace_hygiene)
        : taskShape.workspaceHygiene,
    stop_conditions:
      toStringArray(record.stop_conditions).length > 0
        ? toStringArray(record.stop_conditions)
        : taskShape.stopConditions,
    expected_deliverables:
      toStringArray(record.expected_deliverables).length > 0
        ? toStringArray(record.expected_deliverables)
        : taskShape.expectedDeliverables,
    executor_prompt: firstNonEmptyString(record.executor_prompt, taskShape.executorPrompt),
    executor_prompt_preview: firstNonEmptyString(record.executor_prompt_preview, firstNonEmptyString(record.executor_prompt, taskShape.executorPrompt).slice(0, 320)),
    schema_validation_ok: typeof record.schema_validation_ok === "boolean" ? record.schema_validation_ok : false,
    fallback_reason: firstNonEmptyString(record.fallback_reason) || undefined,
    channel_strategy: firstNonEmptyString(record.channel_strategy) || undefined,
    suggested_plan: suggestedPlan.length > 0 ? suggestedPlan : undefined,
    risk_reasons: riskReasons.length > 0 ? riskReasons : undefined,
    output_language: language,
  };

  if (!firstNonEmptyString(record.original_input)) {
    repairedFields.push("original_input");
  }
  if (!firstNonEmptyString(record.normalized_intent)) {
    repairedFields.push("normalized_intent");
  }
  if (!firstNonEmptyString(record.project_goal)) {
    repairedFields.push("project_goal");
  }
  if (!firstNonEmptyString(record.core_thesis)) {
    repairedFields.push("core_thesis");
  }
  if (!firstNonEmptyString(record.pilot_id)) {
    repairedFields.push("pilot_id");
  }
  if (!firstNonEmptyString(record.current_stage_id)) {
    repairedFields.push("current_stage_id");
  }
  if (!firstNonEmptyString(record.current_stage_name)) {
    repairedFields.push("current_stage_name");
  }
  if (!firstNonEmptyString(record.current_stage_objective)) {
    repairedFields.push("current_stage_objective");
  }
  if (!firstNonEmptyString(record.why_this_stage_now)) {
    repairedFields.push("why_this_stage_now");
  }
  if (toStringArray(record.context_used_summary).length === 0) {
    repairedFields.push("context_used_summary");
  }
  if (!firstNonEmptyString(record.task_objective)) {
    repairedFields.push("task_objective");
  }
  if (!firstNonEmptyString(record.task_translation)) {
    repairedFields.push("task_translation");
  }
  if (toStringArray(record.in_scope).length === 0) {
    repairedFields.push("in_scope");
  }
  if (toStringArray(record.out_of_scope).length === 0) {
    repairedFields.push("out_of_scope");
  }
  if (toStringArray(record.target_files_or_areas).length === 0) {
    repairedFields.push("target_files_or_areas");
  }
  if (toStringArray(record.execution_plan).length === 0) {
    repairedFields.push("execution_plan");
  }
  if (toStringArray(record.validation_checks).length === 0) {
    repairedFields.push("validation_checks");
  }
  if (toStringArray(record.workspace_hygiene).length === 0) {
    repairedFields.push("workspace_hygiene");
  }
  if (toStringArray(record.stop_conditions).length === 0) {
    repairedFields.push("stop_conditions");
  }
  if (toStringArray(record.expected_deliverables).length === 0) {
    repairedFields.push("expected_deliverables");
  }
  if (toStringArray(record.success_criteria).length === 0) {
    repairedFields.push("success_criteria");
  }
  if (toStringArray(record.key_risks).length === 0) {
    repairedFields.push("key_risks");
  }
  if (toStringArray(record.feedback_contract).length === 0) {
    repairedFields.push("feedback_contract");
  }
  if (!firstNonEmptyString(record.generated_command)) {
    repairedFields.push("generated_command");
  }
  if (!firstNonEmptyString(record.generated_command_preview)) {
    repairedFields.push("generated_command_preview");
  }
  if (!firstNonEmptyString(record.next_command)) {
    repairedFields.push("next_command");
  }
  if (!firstNonEmptyString(record.executor_prompt) || firstNonEmptyString(record.executor_prompt).length < 140) {
    repairedFields.push("executor_prompt");
  }
  if (!firstNonEmptyString(record.executor_prompt_preview)) {
    repairedFields.push("executor_prompt_preview");
  }
  if (typeof record.schema_validation_ok !== "boolean") {
    repairedFields.push("schema_validation_ok");
  }
  if (!Array.isArray(record.scope)) {
    repairedFields.push("scope");
  }
  if (!Array.isArray(record.deliverables)) {
    repairedFields.push("deliverables");
  }
  if (typeof record.execution_mode !== "string" || !VALID_EXECUTION_MODES.has(record.execution_mode)) {
    repairedFields.push("execution_mode");
  }
  if (typeof record.run_mode !== "string" || !VALID_RUN_MODES.has(record.run_mode)) {
    repairedFields.push("run_mode");
  }
  if (typeof record.risk_level !== "string" || !VALID_RISK_LEVELS.has(record.risk_level)) {
    repairedFields.push("risk_level");
  }
  if (typeof record.need_confirmation !== "boolean") {
    repairedFields.push("need_confirmation");
  }
  if (!firstNonEmptyString(record.optimized_instruction)) {
    repairedFields.push("optimized_instruction");
  }

  return { result, repairedFields };
}

function validationReason(): string {
  return (
    validateProfessionalization.errors
      ?.map((entry) => `${entry.instancePath || "<root>"} ${entry.message || "invalid"}`)
      .join("; ") ?? "invalid JSON"
  );
}

function resolveProfessionalizerSessionDir(
  api: OpenClawPluginApi,
  config: ResolvedCommandPilotConfig,
): string {
  const override = process.env.OPENCLAW_COMMAND_PILOT_PROFESSIONALIZER_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }

  const stateDir = api.runtime.state?.resolveStateDir?.(process.env);
  if (stateDir) {
    return path.join(stateDir, "plugins", "command-pilot", "professionalizer");
  }

  const workspacePath = config.workspacePath?.trim();
  if (workspacePath && path.isAbsolute(workspacePath) && workspacePath !== path.parse(workspacePath).root) {
    return path.join(workspacePath, ".command-pilot");
  }

  return path.join(os.tmpdir(), "command-pilot-professionalizer");
}

export async function professionalizeWithLlm(params: {
  api: OpenClawPluginApi;
  config: ResolvedCommandPilotConfig;
  input: string;
  mode: "draft" | "preview" | "run";
  context: import("../domain/types.js").GatheredContext;
}): Promise<ProfessionalizationResult> {
  const prompt = buildProfessionalizerPrompt({
    input: params.input,
    mode: params.mode,
    context: params.context,
  });

  const sessionId = `command-pilot-professionalizer-${Date.now()}`;
  const workspaceDir = params.config.workspacePath;
  const sessionDir = resolveProfessionalizerSessionDir(params.api, params.config);
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionFile = path.join(sessionDir, `.command-pilot-professionalizer-${Date.now()}.jsonl`);
  const candidates = buildProfessionalizerCandidates(params.api, params.config);
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const runResult = await params.api.runtime.agent.runEmbeddedPiAgent({
        sessionId,
        runId: `${sessionId}-${candidate.source}`,
        sessionFile,
        workspaceDir,
        config: params.api.config,
        prompt: [
          "You are a JSON-only function.",
          "Return only valid JSON that matches the requested schema.",
          "Do not use tools.",
          "",
          prompt,
        ].join("\n"),
        timeoutMs: params.config.professionalizer.timeoutMs,
        provider: candidate.provider,
        model: candidate.model,
        authProfileId: candidate.authProfileId || undefined,
        authProfileIdSource: candidate.authProfileId ? "user" : "auto",
        disableTools: true,
        streamParams: {
          maxTokens: params.config.professionalizer.maxTokens,
        },
      });

      const rawText = collectText((runResult as { payloads?: Array<{ text?: string; isError?: boolean }> }).payloads);
      const { parsed, syntaxRecovered } = parseProfessionalizerJson(rawText);
      const repaired = repairProfessionalizationResult({
        parsed,
        input: params.input,
        mode: params.mode,
        context: params.context,
      });

      const rawSchemaPass = validateProfessionalization(parsed);
      if (!rawSchemaPass) {
        params.api.logger.warn(
          `command-pilot: professionalizer candidate returned invalid schema (${candidate.source}${candidate.provider ? ` ${candidate.provider}` : ""}${candidate.model ? `/${candidate.model}` : ""}): ${validationReason()}`,
        );
      }

      const normalizedResult: ProfessionalizationResult = {
        ...repaired.result,
        context_used_summary: summarizeContextForDisplay(params.context, params.input),
        executor_prompt_preview: repaired.result.executor_prompt.slice(0, 320),
        schema_validation_ok: true,
      };

      const postRepairSchemaPass = validateProfessionalization(normalizedResult);
      if (!postRepairSchemaPass) {
        throw new Error(`Professionalizer output failed schema validation after repair: ${validationReason()}`);
      }

      if (repaired.repairedFields.length > 0) {
        params.api.logger.info(
          `command-pilot: professionalizer candidate repaired via post-processor (${candidate.source}${candidate.provider ? ` ${candidate.provider}` : ""}${candidate.model ? `/${candidate.model}` : ""}): ${repaired.repairedFields.join(", ")}`,
        );
      }

      params.api.logger.info(
        `command-pilot: professionalizer outcome outcome=${syntaxRecovered ? "repaired_via_syntax_recovery" : repaired.repairedFields.length > 0 ? "repaired_via_post_processor" : "raw_schema_pass"} candidate=${candidate.source} provider=${candidate.provider || "auto"} model=${candidate.model || "auto"} repaired_fields=${repaired.repairedFields.length} raw_parse_pass=${syntaxRecovered ? "no" : "yes"} raw_schema_pass=${rawSchemaPass ? "yes" : "no"} syntax_recovered=${syntaxRecovered ? "yes" : "no"} post_repair_schema_pass=${postRepairSchemaPass ? "yes" : "no"} fallback=no`,
      );

      return normalizedResult;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      params.api.logger.warn(
        `command-pilot: professionalizer candidate failed (${candidate.source}${candidate.provider ? ` ${candidate.provider}` : ""}${candidate.model ? `/${candidate.model}` : ""}): ${message}`,
      );
      if (isAuthSkippedProfessionalizerError(error)) {
        params.api.logger.info(
          `command-pilot: professionalizer outcome outcome=auth_skipped candidate=${candidate.source} provider=${candidate.provider || "auto"} model=${candidate.model || "auto"} repaired_fields=0 raw_parse_pass=no raw_schema_pass=no syntax_recovered=no post_repair_schema_pass=no fallback=no`,
        );
      }
      if (!isRetryableProfessionalizerError(error)) {
        break;
      }
    }
  }

  params.api.logger.warn(
    `command-pilot: professionalizer degraded to minimal structured brief (${lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error")})`,
  );
  params.api.logger.info(
    "command-pilot: professionalizer outcome outcome=minimal_fallback candidate=none provider=none model=none repaired_fields=0 raw_parse_pass=no raw_schema_pass=no syntax_recovered=no post_repair_schema_pass=no fallback=yes",
  );
  return buildMinimalStructuredBrief({
    input: params.input,
    mode: params.mode,
    context: params.context,
    lastError,
  });
}
