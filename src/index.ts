import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { COMMAND_PILOT_BUILD_ID } from "./build-info.js";
import { resolvePluginConfig } from "./config/defaults.js";
import { sanitizePromptBuildMessages } from "./context/context-sanitizer.js";
import { blockReasonForToolCall, findExecutionPolicy } from "./execution/runtime-guards.js";
import type { PilotContextSnapshot } from "./domain/types.js";
import { createServices, handlePilotCommand } from "./orchestration/pilot-orchestrator.js";

function snapshotFromPromptBuild(
  event: { prompt: string; messages: unknown[] },
  ctx: { sessionKey?: string; channelId?: string; messageProvider?: string },
  existing?: PilotContextSnapshot,
): PilotContextSnapshot {
  const recentMessages = sanitizePromptBuildMessages(event.messages.slice(-24));

  return {
    sessionKey: ctx.sessionKey,
    channel: ctx.channelId ?? existing?.channel ?? ctx.messageProvider ?? "unknown",
    accountId: existing?.accountId,
    conversationId: existing?.conversationId,
    senderId: existing?.senderId,
    rawFrom: existing?.rawFrom,
    rawTo: existing?.rawTo,
    messageThreadId: existing?.messageThreadId,
    lastPrompt: event.prompt,
    recentMessages,
    updatedAt: Date.now(),
  };
}

function mergeDispatchContext(
  event: { channel?: string; senderId?: string; body?: string; content: string },
  ctx: { sessionKey?: string; channelId?: string; accountId?: string; conversationId?: string; senderId?: string },
  existing?: PilotContextSnapshot,
): PilotContextSnapshot {
  return {
    sessionKey: ctx.sessionKey ?? existing?.sessionKey,
    channel: ctx.channelId ?? event.channel ?? existing?.channel ?? "unknown",
    accountId: ctx.accountId ?? existing?.accountId,
    conversationId: ctx.conversationId ?? existing?.conversationId,
    senderId: ctx.senderId ?? event.senderId ?? existing?.senderId,
    rawFrom: existing?.rawFrom,
    rawTo: existing?.rawTo,
    messageThreadId: existing?.messageThreadId,
    lastPrompt: existing?.lastPrompt ?? event.body ?? event.content,
    recentMessages: existing?.recentMessages ?? [],
    updatedAt: Date.now(),
  };
}

function shouldLogLocaleTrace(): boolean {
  return process.env.OPENCLAW_COMMAND_PILOT_DEBUG_LOCALE === "1";
}

function resolveRuntimeFingerprint(rootDir?: string) {
  const moduleFilePath = fileURLToPath(import.meta.url);
  const moduleStat = fs.statSync(moduleFilePath);
  return {
    pid: process.pid,
    pluginRootDir: rootDir ?? path.dirname(moduleFilePath),
    moduleFilePath,
    moduleMtime: moduleStat.mtime.toISOString(),
    buildId: COMMAND_PILOT_BUILD_ID,
  };
}

export default definePluginEntry({
  id: "command-pilot",
  name: "Command Pilot",
  description: "Compile rough project ideas into OpenClaw-ready blueprints, with execution reserved for --run.",
  register(api: OpenClawPluginApi) {
    api.logger.info(`command-pilot: register build=${COMMAND_PILOT_BUILD_ID}`);
    (globalThis as { __OPENCLAW_COMMAND_PILOT_TRACE_LOG__?: { info?: (message: string) => void } }).__OPENCLAW_COMMAND_PILOT_TRACE_LOG__ = api.logger;
    (globalThis as { __OPENCLAW_COMMAND_PILOT_DEBUG_LOCALE__?: boolean }).__OPENCLAW_COMMAND_PILOT_DEBUG_LOCALE__ = shouldLogLocaleTrace();
    const fingerprint = resolveRuntimeFingerprint(api.rootDir);
    api.logger.info(
      `command-pilot: runtime fingerprint pid=${fingerprint.pid} plugin_root=${fingerprint.pluginRootDir} module=${fingerprint.moduleFilePath} module_mtime=${fingerprint.moduleMtime} build=${fingerprint.buildId}`,
    );
    const pluginConfig = resolvePluginConfig(api.pluginConfig);
    const services = createServices(api, pluginConfig);

    void services.cache.load();

    api.registerCommand({
      name: "pilot",
      description: "Compile a project idea into a blueprint, or auto-run the current stage with --run.",
      acceptsArgs: true,
      handler: async (ctx) => await handlePilotCommand({ api, ctx, pluginConfig, services }),
    });

    api.on("before_dispatch", async (event, ctx) => {
      const existing = services.cache.find({
        sessionKey: ctx.sessionKey,
        channel: ctx.channelId ?? event.channel ?? "unknown",
        accountId: ctx.accountId,
        conversationId: ctx.conversationId,
        senderId: ctx.senderId,
      });
      services.cache.remember(mergeDispatchContext(event, ctx, existing));
      await services.cache.persist();
    });

    api.on("before_prompt_build", async (event, ctx) => {
      const existing = services.cache.find({
        sessionKey: ctx.sessionKey,
        channel: ctx.channelId ?? ctx.messageProvider ?? "unknown",
        senderId: undefined,
      });
      services.cache.remember(snapshotFromPromptBuild(event, ctx, existing));
      await services.cache.persist();
      return;
    });

    api.registerHook("before_tool_call", ((event: { toolName: string; params: Record<string, unknown>; runId?: string }, ctx: { runId?: string }) => {
      const policy = findExecutionPolicy(ctx.runId ?? event.runId);
      if (!policy) {
        return;
      }
      const blockReason = blockReasonForToolCall(policy, event.toolName, event.params);
      if (!blockReason) {
        return;
      }
      api.logger.warn(`command-pilot: blocked tool call (${event.toolName}) run=${ctx.runId ?? event.runId ?? "unknown"} reason=${blockReason}`);
      return {
        block: true,
        blockReason,
      };
    }) as unknown as Parameters<typeof api.registerHook>[1]);

    api.registerCli(({ program }) => {
      program
        .command("command-pilot:print-default-risk-policy")
        .description("Print the Command Pilot bundled risk policy path.")
        .action(() => {
          const bundled = path.resolve(api.rootDir ?? process.cwd(), "config", "risk-policy.sample.json");
          process.stdout.write(`${bundled}\n`);
        });
      program
        .command("command-pilot:print-runtime-fingerprint")
        .description("Print the Command Pilot runtime fingerprint for the currently loaded module.")
        .action(() => {
          const current = resolveRuntimeFingerprint(api.rootDir);
          process.stdout.write(`${JSON.stringify(current)}\n`);
        });
    }, {
      commands: ["command-pilot:print-default-risk-policy", "command-pilot:print-runtime-fingerprint"],
      descriptors: [
        {
          name: "command-pilot:print-default-risk-policy",
          description: "Print the Command Pilot bundled risk policy path.",
          hasSubcommands: false,
        },
        {
          name: "command-pilot:print-runtime-fingerprint",
          description: "Print the Command Pilot runtime fingerprint for the currently loaded module.",
          hasSubcommands: false,
        },
      ],
    });
  },
});
