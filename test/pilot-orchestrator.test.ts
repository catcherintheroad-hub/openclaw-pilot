import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi, PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";
import { ConversationCache } from "../src/context/conversation-cache.js";
import type { CommandPilotConfig } from "../src/domain/types.js";
import { handlePilotCommand } from "../src/orchestration/pilot-orchestrator.js";
import { PendingApprovalsStore } from "../src/orchestration/pending-approvals.js";
import { PilotStateStore } from "../src/orchestration/pilot-state-store.js";

type EmbeddedRunResult = Awaited<
  ReturnType<NonNullable<OpenClawPluginApi["runtime"]["agent"]["runEmbeddedPiAgent"]>>
>;
const execFileAsync = promisify(execFile);

function createApi(runEmbeddedPiAgent: NonNullable<OpenClawPluginApi["runtime"]["agent"]["runEmbeddedPiAgent"]>): OpenClawPluginApi {
  return {
    config: {},
    runtime: {
      agent: {
        defaults: {
          provider: "openai-codex",
          model: "openai-codex/gpt-5.4",
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

function baseProfessionalizerPayload() {
  return {
    original_input: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
    normalized_intent: "统一 OCAX 首页与 roles 页的 linear 风格",
    goal: "统一前端页面视觉风格",
    scope: ["OCAX 首页", "roles 页", "前端界面"],
    constraints: ["先审计再改", "不要动后端"],
    deliverables: ["审计 brief", "前端改动计划", "优化后的执行指令"],
    execution_mode: "preview",
    risk_level: "low",
    need_confirmation: false,
    optimized_instruction: "Audit the OCAX homepage and roles page, align them to a linear-style frontend treatment, and avoid backend changes.",
    context_used_summary: ["recent UI task discussion", "current workspace intent", "constraints from recent discussion"],
    task_objective: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
    task_translation: "Translate the request into a frontend-only audit-and-implement plan for the OCAX homepage and roles page.",
    in_scope: ["OCAX homepage", "roles page", "shared frontend styling layers"],
    out_of_scope: ["backend code", "API contracts", "database or server changes"],
    target_files_or_areas: ["app/page.tsx", "app/node/page.tsx", "app/caller/page.tsx", "app/globals.css"],
    execution_plan: ["Audit first", "Map scoped files", "Implement frontend-only changes", "Validate affected pages"],
    validation_checks: ["No backend files changed", "Only intended frontend files changed"],
    workspace_hygiene: ["Avoid unrelated changes", "Call out pre-existing dirty files"],
    stop_conditions: ["Stop if backend changes are required", "Stop if dirty target files overlap"],
    expected_deliverables: ["Audit summary", "Scoped plan", "Validation summary"],
    executor_prompt: "Act as the execution agent for a scoped frontend refinement task. Audit the OCAX homepage, roles page, and any directly related caller/node surfaces first; then touch only app/page.tsx, app/node/page.tsx, app/caller/page.tsx, app/globals.css, and directly related style primitives. Do not touch backend, app/api, or database code. Stop if dirty target overlap is detected.",
    executor_prompt_preview: "Act as the execution agent for a scoped frontend refinement task. Audit the OCAX homepage...",
    schema_validation_ok: true,
  };
}

describe("pilot orchestrator", () => {
  it("compiles plan_only requests without storing approvals or executing handoff", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "command-pilot-test-"));
    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [
        {
          text: JSON.stringify(baseProfessionalizerPayload()),
        },
      ],
      meta: { durationMs: 1 },
    }));
    const api = createApi(runEmbeddedPiAgent);
    const services = {
      cache: new ConversationCache(path.join(tempDir, "context-cache.json"), 50),
      approvals: new PendingApprovalsStore(path.join(tempDir, "pending-approvals.json")),
      states: new PilotStateStore(path.join(tempDir, "pilot-states.json")),
    };
    const ctx = {
      args: "把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
      channel: "webchat",
      from: "webchat:user-1",
      to: "webchat:session-1",
      senderId: "user-1",
      accountId: "default",
    } as unknown as PluginCommandContext;
    const pluginConfig: CommandPilotConfig = {
      workspacePath: tempDir,
    };

    const response = await handlePilotCommand({
      api,
      ctx,
      pluginConfig,
      services,
    });

    const pending = await services.approvals.list();
    expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(0);
    expect(response.text).toContain("A. Command Pilot 蓝图");
    expect(response.text).toContain("[OPENCLAW_EXECUTION_PACKET v1]");
    expect(response.text).toContain("B. 可直接发送给 OpenClaw 的命令");
    expect(response.text).toContain("C. 应回传给 /pilot 的内容");
    expect(response.text).toContain("D. 下一条命令");
    expect(response.text).not.toContain("A. Command Pilot Blueprint");
    expect(response.text).not.toContain("Pilot ID");
    expect(response.text).not.toContain("Project Goal");
    expect(response.text).not.toContain("ROLE:");
    expect(response.text).not.toContain("Pilot renderer version");
    expect(response.text).not.toContain("Build:");
    expect(response.text).not.toContain("plan_only");
    expect(response.text).toContain("/pilot next");
    expect(Array.isArray((response as { messages?: unknown[] }).messages)).toBe(true);
    expect((response as { messages?: Array<{ text: string }> }).messages).toHaveLength(2);
    const responseMessages = (response as unknown as { messages: Array<{ text: string }> }).messages;
    expect(responseMessages[0].text).toContain("A. Command Pilot 蓝图");
    expect(responseMessages[0].text).toContain("可直接发送给 OpenClaw 的命令已在下一条消息单独发送");
    expect(responseMessages[0].text).not.toContain("[OPENCLAW_EXECUTION_PACKET v1]");
    expect(responseMessages[1].text).toContain("[OPENCLAW_EXECUTION_PACKET v1]");
    expect(responseMessages[1].text).not.toContain("A. Command Pilot 蓝图");
    expect(responseMessages[1].text).not.toContain("C. 应回传给 /pilot 的内容");
    expect(responseMessages[1].text).not.toContain("D. 下一条命令");
  });

  it("keeps dirty target overlap gated behind auto_run", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "command-pilot-git-"));
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await fs.mkdir(path.join(tempDir, "app"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "app/page.tsx"), "export default function Page() { return null; }\n");
    await fs.writeFile(path.join(tempDir, "app/globals.css"), "body { color: black; }\n");
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "init"], {
      cwd: tempDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    });
    await fs.writeFile(path.join(tempDir, "app/page.tsx"), "export default function Page() { return <main>dirty</main>; }\n");

    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [{ text: JSON.stringify(baseProfessionalizerPayload()) }],
      meta: { durationMs: 1 },
    }));
    const api = createApi(runEmbeddedPiAgent);
    const services = {
      cache: new ConversationCache(path.join(tempDir, "context-cache.json"), 50),
      approvals: new PendingApprovalsStore(path.join(tempDir, "pending-approvals.json")),
      states: new PilotStateStore(path.join(tempDir, "pilot-states.json")),
    };

    await handlePilotCommand({
      api,
      ctx: {
        args: "--run 把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端",
        channel: "webchat",
        from: "webchat:user-1",
        to: "webchat:session-1",
        senderId: "user-1",
        accountId: "default",
      } as unknown as PluginCommandContext,
      pluginConfig: { workspacePath: tempDir },
      services,
    });

    expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    expect(await services.approvals.list()).toHaveLength(1);
  });

  it("executes auto_run requests when guards are clear", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "command-pilot-continue-"));
    const payload = baseProfessionalizerPayload();
    const runEmbeddedPiAgent = vi
      .fn()
      .mockResolvedValueOnce({
        payloads: [{ text: JSON.stringify(payload) }],
        meta: { durationMs: 1 },
      } as EmbeddedRunResult)
      .mockResolvedValueOnce({
        payloads: [{ text: "execution summary" }],
        meta: { durationMs: 1 },
      } as EmbeddedRunResult);
    const api = createApi(runEmbeddedPiAgent);
    const services = {
      cache: new ConversationCache(path.join(tempDir, "context-cache.json"), 50),
      approvals: new PendingApprovalsStore(path.join(tempDir, "pending-approvals.json")),
      states: new PilotStateStore(path.join(tempDir, "pilot-states.json")),
    };
    const baseCtx = {
      channel: "webchat",
      from: "webchat:user-1",
      to: "webchat:session-1",
      senderId: "user-1",
      accountId: "default",
    } as unknown as PluginCommandContext;

    await handlePilotCommand({
      api,
      ctx: { ...baseCtx, args: "--run 把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端" },
      pluginConfig: { workspacePath: tempDir },
      services,
    });

    expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(2);
    expect(await services.approvals.list()).toHaveLength(0);
  });

  it("supports status and next on persisted pilot state", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "command-pilot-status-"));
    const runEmbeddedPiAgent = vi.fn(async (): Promise<EmbeddedRunResult> => ({
      payloads: [{ text: JSON.stringify(baseProfessionalizerPayload()) }],
      meta: { durationMs: 1 },
    }));
    const api = createApi(runEmbeddedPiAgent);
    const services = {
      cache: new ConversationCache(path.join(tempDir, "context-cache.json"), 50),
      approvals: new PendingApprovalsStore(path.join(tempDir, "pending-approvals.json")),
      states: new PilotStateStore(path.join(tempDir, "pilot-states.json")),
    };
    const baseCtx = {
      channel: "webchat",
      from: "webchat:user-1",
      to: "webchat:session-1",
      senderId: "user-1",
      accountId: "default",
    } as unknown as PluginCommandContext;

    const initial = await handlePilotCommand({
      api,
      ctx: { ...baseCtx, args: "我想做一个利用 OpenClaw 跑的小红书内容自动化项目，核心是搜集最近热门内容、生成文案和配图，但先不要直接发帖" },
      pluginConfig: { workspacePath: tempDir },
      services,
    });
    const [state] = await services.states.list();

    const status = await handlePilotCommand({
      api,
      ctx: { ...baseCtx, args: `status ${state.pilot_id}` },
      pluginConfig: { workspacePath: tempDir },
      services,
    });
    const next = await handlePilotCommand({
      api,
      ctx: { ...baseCtx, args: `next ${state.pilot_id} + STATUS: blocked SUMMARY: missing market scope` },
      pluginConfig: { workspacePath: tempDir },
      services,
    });

    expect(initial.text).toContain(`/pilot next ${state.pilot_id}`);
    expect(status.text).toContain("A. Command Pilot 蓝图");
    expect(status.text).toContain(state.pilot_id);
    expect(next.text).toContain("D. 下一条命令");
    expect(next.text).toContain(state.pilot_id);
    expect(Array.isArray((next as { messages?: unknown[] }).messages)).toBe(true);
    expect((next as { messages?: Array<{ text: string }> }).messages).toHaveLength(2);
    const nextMessages = (next as unknown as { messages: Array<{ text: string }> }).messages;
    expect(nextMessages[0].text).toContain("A. Command Pilot 蓝图");
    expect(nextMessages[0].text).toContain("可直接发送给 OpenClaw 的命令已在下一条消息单独发送");
    expect(nextMessages[0].text).not.toContain("[OPENCLAW_EXECUTION_PACKET v1]");
    expect(nextMessages[1].text).toContain("[OPENCLAW_EXECUTION_PACKET v1]");
    expect(nextMessages[1].text).not.toContain("A. Command Pilot 蓝图");
  });
});
