import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { COMMAND_PILOT_BUILD_ID } from "../src/build-info.js";
import type { GatheredContext, ResolvedCommandPilotConfig } from "../src/domain/types.js";
import { renderApprovalNeeded, renderPreview } from "../src/orchestration/pilot-renderer.js";
import { __structuredLlmInternals, professionalizeWithLlm } from "../src/professionalizer/structured-llm.js";
import { classifyRisk } from "../src/risk/risk-classifier.js";

type EmbeddedRunResult = Awaited<
  ReturnType<NonNullable<OpenClawPluginApi["runtime"]["agent"]["runEmbeddedPiAgent"]>>
>;

function createStructuredPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    original_input: "do thing",
    normalized_intent: "do thing",
    goal: "do thing",
    project_goal: "do thing",
    core_thesis: "do thing",
    pilot_id: "pilot-test",
    current_stage_id: "stage-1",
    current_stage_name: "Stage 1",
    current_stage_objective: "Do the first scoped stage",
    why_this_stage_now: "Start with a scoped first step.",
    scope: ["current project"],
    constraints: [],
    deliverables: ["brief"],
    execution_mode: "preview",
    run_mode: "plan_only",
    risk_level: "low",
    need_confirmation: false,
    success_criteria: ["matches the request"],
    key_risks: ["none"],
    generated_command: "[OPENCLAW_EXECUTION_PACKET v1]\n[END_OPENCLAW_EXECUTION_PACKET]",
    generated_command_preview: "[OPENCLAW_EXECUTION_PACKET v1]",
    feedback_contract: ["STATUS"],
    next_command: "/pilot next pilot-test",
    optimized_instruction: "Do thing safely.",
    context_used_summary: ["context"],
    task_objective: "Do thing",
    task_translation: "Translate thing into action",
    in_scope: ["current project"],
    out_of_scope: ["unrelated files"],
    target_files_or_areas: ["current project"],
    execution_plan: ["audit", "plan", "report"],
    validation_checks: ["matches the request"],
    workspace_hygiene: ["keep unrelated areas untouched"],
    stop_conditions: ["stop on missing input"],
    expected_deliverables: ["brief"],
    executor_prompt: "Do thing safely.",
    executor_prompt_preview: "Do thing safely.",
    schema_validation_ok: true,
    output_language: "en",
    ...overrides,
  };
}

function createConfig(): ResolvedCommandPilotConfig {
  return {
    workspacePath: "/tmp",
    standingOrders: {
      enabled: true,
      paths: [],
      maxCharsPerFile: 6000,
    },
    professionalizer: {
      provider: "",
      model: "",
      authProfileId: "",
      fallbackChain: [
        { provider: "openai-codex", model: "gpt-5.4", authProfileId: "" },
      ],
      timeoutMs: 90000,
      maxTokens: 2200,
    },
    execution: {
      mode: "embedded-agent",
      timeoutMs: 120000,
      autoRunRiskLevels: ["low", "medium-low"],
    },
    riskPolicyPath: "",
    context: {
      historyTurns: 8,
      maxMessages: 24,
      cacheFileLimit: 300,
    },
  };
}

function createContext(): GatheredContext {
  return {
    snapshot: {
      channel: "webchat",
      recentMessages: [{ role: "user", text: "previous discussion" }],
      updatedAt: Date.now(),
    },
    standingOrders: [],
    channelSummary: ["channel=webchat"],
  };
}

function createApi(
  runEmbeddedPiAgent: NonNullable<OpenClawPluginApi["runtime"]["agent"]["runEmbeddedPiAgent"]>,
): OpenClawPluginApi {
  return {
    config: {},
    runtime: {
      agent: {
        defaults: {
          provider: "anthropic",
          model: "anthropic/claude-opus-4-6",
        },
        runEmbeddedPiAgent,
      },
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as OpenClawPluginApi;
}

describe("professionalizeWithLlm", () => {
  it("prefers the runtime default candidate before plugin fallbacks when no plugin config is pinned", async () => {
    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [
        {
          text: JSON.stringify(createStructuredPayload()),
        },
      ],
      meta: {
        durationMs: 1,
      },
    }));
    const api = createApi(runEmbeddedPiAgent);

    await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "do thing",
      mode: "preview",
      context: createContext(),
    });

    expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    const firstCall = runEmbeddedPiAgent.mock.calls[0] as unknown as Array<Record<string, unknown>> | undefined;
    expect(firstCall?.[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
  });

  it("degrades to a minimal structured brief when retryable candidates keep failing", async () => {
    const runEmbeddedPiAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 rate_limit_error"))
      .mockRejectedValueOnce(new Error("429 rate_limit_error"))
      .mockRejectedValueOnce(new Error("surface_error"));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "帮我把当前项目直接推到远程主分支",
      mode: "run",
      context: createContext(),
    });

    expect(result.original_input).toContain("远程主分支");
    expect(result.optimized_instruction).toMatch(/wait for explicit confirmation|得到明确确认/);
    expect(result.risk_reasons?.[0]).toMatch(/degraded|已降级/);
  });

  it("treats missing provider auth as retryable so later candidates can still run", () => {
    expect(
      __structuredLlmInternals.isRetryableProfessionalizerError(
        new Error("No API key found for provider \"openrouter\""),
      ),
    ).toBe(true);
    expect(
      __structuredLlmInternals.isRetryableProfessionalizerError(
        new Error("No available auth profile for anthropic (all in cooldown or unavailable)."),
      ),
    ).toBe(true);
  });

  it("accepts a runtime-default candidate that already matches the full schema", async () => {
    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [{ text: JSON.stringify(createStructuredPayload({ goal: "runtime default success" })) }],
      meta: { durationMs: 1 },
    }));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "do thing",
      mode: "preview",
      context: createContext(),
    });

    expect(result.goal).toBe("runtime default success");
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("professionalizer outcome outcome=repaired_via_post_processor"),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("raw_parse_pass=yes"),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("raw_schema_pass=yes"),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("syntax_recovered=no"),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("post_repair_schema_pass=yes"),
    );
  });

  it("repairs a runtime-default candidate that is missing output_language", async () => {
    const payload = createStructuredPayload();
    delete payload.output_language;
    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [{ text: JSON.stringify(payload) }],
      meta: { durationMs: 1 },
    }));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "我想做一个文档核对 MVP",
      mode: "preview",
      context: createContext(),
    });

    expect(result.output_language).toBe("zh-CN");
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("professionalizer outcome outcome=repaired_via_post_processor"),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("raw_parse_pass=yes"),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("raw_schema_pass=yes"),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("post_repair_schema_pass=yes"),
    );
  });

  it("continues after two auth-skipped candidates and succeeds on the third candidate", async () => {
    const runEmbeddedPiAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("No available auth profile for plugin-config"))
      .mockRejectedValueOnce(new Error("No API key found for provider \"anthropic\""))
      .mockResolvedValueOnce({
        payloads: [{ text: JSON.stringify(createStructuredPayload({ goal: "third candidate success" })) }],
        meta: { durationMs: 1 },
      } satisfies EmbeddedRunResult);
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: {
        ...createConfig(),
        professionalizer: {
          ...createConfig().professionalizer,
          provider: "openai-codex",
          model: "gpt-5.4",
          fallbackChain: [{ provider: "minimax", model: "MiniMax-M2.7", authProfileId: "" }],
        },
      },
      input: "do thing",
      mode: "preview",
      context: createContext(),
    });

    expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(3);
    expect(result.goal).toBe("third candidate success");
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("professionalizer outcome outcome=auth_skipped"),
    );
    expect(api.logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("professionalizer degraded to minimal structured brief"),
    );
  });

  it("still degrades to the minimal fallback when every candidate fails", async () => {
    const runEmbeddedPiAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("No available auth profile for plugin-config"))
      .mockRejectedValueOnce(new Error("No API key found for provider \"anthropic\""))
      .mockRejectedValueOnce(new Error("surface_error"));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: {
        ...createConfig(),
        professionalizer: {
          ...createConfig().professionalizer,
          provider: "openai-codex",
          model: "gpt-5.4",
          fallbackChain: [{ provider: "minimax", model: "MiniMax-M2.7", authProfileId: "" }],
        },
      },
      input: "帮我把当前项目直接推到远程主分支",
      mode: "run",
      context: createContext(),
    });

    expect(result.risk_reasons?.[0]).toMatch(/degraded|已降级/);
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("professionalizer outcome outcome=minimal_fallback"),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("fallback=yes"),
    );
  });

  it("drops polluted transcript items from the context summary while preserving high-risk classification", async () => {
    const runEmbeddedPiAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 rate_limit_error"))
      .mockRejectedValueOnce(new Error("429 rate_limit_error"))
      .mockRejectedValueOnce(new Error("surface_error"));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "帮我把当前项目直接推到远程主分支",
      mode: "run",
      context: {
        snapshot: {
          channel: "telegram",
          recentMessages: [
            { role: "assistant", text: "Command Pilot Brief\nRisk: high\nConfirmation required: yes" },
            { role: "assistant", text: "NEXT_CMD: /pilot confirm pilot-123" },
            { role: "assistant", text: "Gateway is draining for restart" },
            { role: "assistant", text: "Conversation info (untrusted metadata): telegram chat wrapper" },
            { role: "assistant", text: "queued-message delivery retry pending" },
            { role: "toolResult", text: "toolResult: auto-pushing main to origin..." },
            { role: "assistant", text: "assistant: toolCall exec git commit -m 'ship it'" },
            { role: "assistant", text: "toolResult: Successfully replaced 2 block(s) in src/index.ts" },
            { role: "assistant", text: "To https://github.com/example/repo.git" },
            { role: "assistant", text: "[main abc1234] chore: update plugin" },
            { role: "user", text: "当前项目先别动生产，只处理本地仓库" },
          ],
          updatedAt: Date.now(),
        },
        standingOrders: [],
        channelSummary: [
          "recent operational task discussion",
          "current workspace intent",
          "no strong prior constraints found",
        ],
      },
    });

    const risk = classifyRisk({
      input: "帮我把当前项目直接推到远程主分支",
      result,
      policy: {
        blockedSilentPatterns: [
          {
            id: "push-main",
            match: "push|主分支|remote",
            riskLevel: "high",
            action: "confirm",
            reason: "Remote mutations require confirmation.",
          },
        ],
        destructiveHints: ["push", "主分支", "remote"],
        defaultAutoRunRiskLevels: ["low", "medium-low"],
      },
    });

    expect(risk.level).toBe("high");
    expect(risk.needConfirmation).toBe(true);
    expect(result.context_used_summary.join(" | ")).toContain("current workspace intent");
    expect(result.context_used_summary.join(" | ")).not.toContain("Command Pilot Brief");
    expect(result.context_used_summary.join(" | ")).not.toContain("Gateway is draining");
    expect(result.context_used_summary.join(" | ")).not.toContain("Conversation info");
    expect(result.context_used_summary.join(" | ")).not.toContain("queued-message");
    expect(result.context_used_summary.join(" | ")).not.toContain("toolCall");
    expect(result.context_used_summary.join(" | ")).not.toContain("toolResult");
    expect(result.context_used_summary.join(" | ")).not.toContain("git commit");
    expect(result.context_used_summary.join(" | ")).not.toContain("auto-pushing");
  });

  it("renders the high-risk confirmation branch with sanitized context summary only", async () => {
    const runEmbeddedPiAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 rate_limit_error"))
      .mockRejectedValueOnce(new Error("429 rate_limit_error"))
      .mockRejectedValueOnce(new Error("surface_error"));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "帮我把当前项目直接推到远程主分支",
      mode: "run",
      context: {
        snapshot: {
          channel: "telegram",
          recentMessages: [
            { role: "toolCall", text: "exec git push origin main" },
            { role: "toolResult", text: "toolResult: auto-pushing main to origin..." },
            { role: "assistant", text: "assistant: toolCall exec git commit -m 'ship it'" },
            { role: "assistant", text: "To https://github.com/example/repo.git" },
            { role: "assistant", text: "[main abc1234] chore: update plugin" },
            { role: "assistant", text: "Conversation info (untrusted metadata): telegram chat wrapper" },
            { role: "user", text: "当前项目先别动生产，只处理本地仓库" },
          ],
          updatedAt: Date.now(),
        },
        standingOrders: [],
        channelSummary: [],
      },
    });

    const risk = classifyRisk({
      input: "帮我把当前项目直接推到远程主分支",
      result,
      policy: {
        blockedSilentPatterns: [
          {
            id: "push-main",
            match: "push|主分支|remote",
            riskLevel: "high",
            action: "confirm",
            reason: "Remote mutations require confirmation.",
          },
        ],
        destructiveHints: ["push", "主分支", "remote"],
        defaultAutoRunRiskLevels: ["low", "medium-low"],
      },
    });

    const rendered = renderApprovalNeeded({
      id: "pilot-test",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      request: { action: "process", mode: "run", rawInput: "帮我把当前项目直接推到远程主分支" },
      context: {
        channel: "telegram",
        recentMessages: [],
        updatedAt: Date.now(),
      },
      result,
      risk,
    });

    expect(risk.level).toBe("high");
    expect(risk.needConfirmation).toBe(true);
    expect(rendered).toContain(`Build: ${COMMAND_PILOT_BUILD_ID}`);
    expect(rendered).toContain("Context used:");
    expect(rendered).not.toContain("toolCall");
    expect(rendered).not.toContain("toolResult");
    expect(rendered).not.toContain("git push");
    expect(rendered).not.toContain("git commit");
    expect(rendered).not.toContain("Conversation info");
    expect(rendered).not.toContain("Recent messages captured:");
  });

  it("repairs missing required fields from model output before rendering", async () => {
    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [
        {
          text: JSON.stringify({
            goal: "统一前端页面视觉风格",
            scope: ["OCAX 首页", "roles 页"],
            constraints: ["先审计再改", "不要动后端"],
            deliverables: ["审计 brief", "改动计划"],
            execution_mode: "preview",
            risk_level: "low",
            need_confirmation: false,
            optimized_instruction: "Audit first, then align the OCAX homepage and roles page to a linear-style frontend treatment without backend changes.",
          }),
        },
      ],
      meta: { durationMs: 1 },
    }));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
      mode: "preview",
      context: createContext(),
    });

    const preview = renderPreview({
      result,
      risk: {
        level: "low",
        needConfirmation: false,
        reasons: [],
      },
      context: createContext(),
    });

    expect(result.original_input).toBe("把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端");
    expect(result.normalized_intent).toBeTruthy();
    expect(result.context_used_summary.length).toBeGreaterThan(0);
    expect(preview).toContain("Command Pilot Brief");
    expect(preview).toContain(`Build: ${COMMAND_PILOT_BUILD_ID}`);
    expect(preview).toContain("Executor prompt preview:");
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("candidate returned invalid schema"),
    );
  });

  it("repairs partial field output and still renders a complete brief", async () => {
    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [
        {
          text: JSON.stringify({
            original_input: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
            goal: "统一前端页面视觉风格",
            scope: ["OCAX 首页", "roles 页", "前端界面"],
            constraints: ["先审计再改", "不要动后端"],
            deliverables: ["审计 brief", "前端改动计划"],
            optimized_instruction: "Audit the current frontend first and then align the OCAX homepage and roles page without backend changes.",
            need_confirmation: false,
          }),
        },
      ],
      meta: { durationMs: 1 },
    }));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
      mode: "preview",
      context: createContext(),
    });

    const preview = renderPreview({
      result,
      risk: {
        level: result.risk_level,
        needConfirmation: result.need_confirmation,
        reasons: [],
      },
      context: createContext(),
    });

    expect(result.original_input).toContain("OCAX 首页");
    expect(result.normalized_intent).toBeTruthy();
    expect(result.context_used_summary.length).toBeGreaterThan(0);
    expect(preview).toContain("Command Pilot Brief");
    expect(preview).toContain("Deliverables:");
    expect(preview).toContain("Executor prompt preview:");
  });

  it("repairs a truncated JSON object at the parser layer", () => {
    const result = __structuredLlmInternals.parseProfessionalizerJson(
      "{\"goal\":\"先定义一个可运行的跨境电商单据核对 MVP 蓝图\",\"execution_mode\":\"preview\"",
    );
    const parsed = result.parsed as Record<string, unknown>;

    expect(parsed.goal).toBe("先定义一个可运行的跨境电商单据核对 MVP 蓝图");
    expect(parsed.execution_mode).toBe("preview");
    expect(result.syntaxRecovered).toBe(true);
  });

  it("repairs a missing comma between array elements at the parser layer", () => {
    const result = __structuredLlmInternals.parseProfessionalizerJson(
      "{\"scope\":[\"合同\" \"发票\",\"装箱单\"],\"execution_mode\":\"preview\"}",
    );
    const parsed = result.parsed as Record<string, unknown>;

    expect(parsed.execution_mode).toBe("preview");
    expect(parsed.scope).toEqual(["合同", "发票", "装箱单"]);
    expect(result.syntaxRecovered).toBe(true);
  });

  it("repairs a missing comma between object properties at the parser layer", () => {
    const result = __structuredLlmInternals.parseProfessionalizerJson(
      "{\"goal\":\"文档核对 MVP\" \"project_goal\":\"文档核对 MVP\",\"execution_mode\":\"preview\"}",
    );
    const parsed = result.parsed as Record<string, unknown>;

    expect(parsed.goal).toBe("文档核对 MVP");
    expect(parsed.project_goal).toBe("文档核对 MVP");
    expect(parsed.execution_mode).toBe("preview");
    expect(result.syntaxRecovered).toBe(true);
  });

  it("does not mark unrelated parse errors as bounded syntax recovery", () => {
    expect(
      __structuredLlmInternals.isBoundedSyntaxRecoveryError(
        new Error("Expected ',' or ']' after array element in JSON at position 1205"),
      ),
    ).toBe(true);
    expect(
      __structuredLlmInternals.isBoundedSyntaxRecoveryError(
        new Error("Expected ',' or '}' after property value in JSON at position 617"),
      ),
    ).toBe(true);
    expect(
      __structuredLlmInternals.isBoundedSyntaxRecoveryError(
        new Error("Unexpected non-whitespace character after JSON at position 3255"),
      ),
    ).toBe(false);
  });

  it("falls back when malformed JSON is outside the bounded syntax recovery whitelist", async () => {
    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [{ text: "{\"goal\":\"文档核对\" @@@ \"execution_mode\":\"preview\"}" }],
      meta: { durationMs: 1 },
    }));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "我想做一个文档核对 MVP",
      mode: "preview",
      context: createContext(),
    });

    expect(result.risk_reasons?.[0]).toMatch(/degraded|已降级/);
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("professionalizer outcome outcome=minimal_fallback"),
    );
  });

  it("resolves the professionalizer session directory under plugin state by default", () => {
    const api = createApi(vi.fn());
    (api.runtime as { state?: { resolveStateDir: (_env: NodeJS.ProcessEnv) => string } }).state = {
      resolveStateDir: () => "/tmp/openclaw-state",
    };

    expect(__structuredLlmInternals.resolveProfessionalizerSessionDir(api, createConfig())).toBe(
      "/tmp/openclaw-state/plugins/command-pilot/professionalizer",
    );
  });

  it("falls back to tmp when workspacePath resolves to root and no plugin state dir exists", () => {
    const api = createApi(vi.fn());
    const config = {
      ...createConfig(),
      workspacePath: "/",
    };

    expect(__structuredLlmInternals.resolveProfessionalizerSessionDir(api, config)).toMatch(
      /command-pilot-professionalizer$/,
    );
  });

  it("produces a task-specific executor prompt for UI work", async () => {
    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [
        {
          text: JSON.stringify({
            original_input: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
            normalized_intent: "统一 OCAX 首页与 roles 页的 linear 风格",
            goal: "统一前端页面视觉风格",
            scope: ["OCAX 首页", "roles 页", "前端界面"],
            constraints: ["先审计再改", "不要动后端"],
            deliverables: ["审计 brief", "前端改动计划", "优化后的执行指令"],
            execution_mode: "preview",
            risk_level: "low",
            need_confirmation: false,
            optimized_instruction: "Audit the two frontend pages, then align them to a consistent linear-style direction without backend changes.",
          }),
        },
      ],
      meta: { durationMs: 1 },
    }));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
      mode: "preview",
      context: createContext(),
    });

    expect(result.in_scope.join(" | ")).toMatch(/homepage|roles page|frontend|首页|页面|前端/i);
    expect(result.out_of_scope.join(" | ")).toMatch(/backend|api|server|后端/i);
    expect(result.target_files_or_areas.join(" | ")).toMatch(/homepage|roles|css|style|typography|首页|样式|字体/i);
    expect(result.workspace_hygiene.join(" | ")).toMatch(/frontend|unrelated|dirty|前端|无关|脏文件/i);
    expect(result.executor_prompt).toMatch(/OCAX homepage|roles page|OCAX 首页|roles 页面/i);
    expect(result.executor_prompt).toMatch(/linear-style|frontend-only|shared-style|linear 风格|纯前端|共享样式/i);
    expect(result.executor_prompt).not.toMatch(/keep scope tight.*execute in staged steps/i);
  });

  it("produces a task-specific executor prompt for high-risk git work", async () => {
    const runEmbeddedPiAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 rate_limit_error"))
      .mockRejectedValueOnce(new Error("429 rate_limit_error"))
      .mockRejectedValueOnce(new Error("surface_error"));
    const api = createApi(runEmbeddedPiAgent);

    const result = await professionalizeWithLlm({
      api,
      config: createConfig(),
      input: "帮我把当前项目直接推到远程主分支",
      mode: "run",
      context: createContext(),
    });

    const risk = classifyRisk({
      input: "帮我把当前项目直接推到远程主分支",
      result,
      policy: {
        blockedSilentPatterns: [
          {
            id: "push-main",
            match: "push|主分支|remote",
            riskLevel: "high",
            action: "confirm",
            reason: "Remote mutations require confirmation.",
          },
        ],
        destructiveHints: ["push", "主分支", "remote"],
        defaultAutoRunRiskLevels: ["low", "medium-low"],
      },
    });

    expect(risk.level).toBe("high");
    expect(result.executor_prompt).toMatch(/git status|branch|remote|confirmation-gated|blast radius/i);
    expect(result.executor_prompt).not.toMatch(/^wait for confirmation\.?$/i);
    expect(result.execution_plan.join(" | ")).toMatch(/inventory|remote|confirm/i);
    expect(result.validation_checks.join(" | ")).toMatch(/remote mutation|blast radius|confirmation/i);
  });
});
