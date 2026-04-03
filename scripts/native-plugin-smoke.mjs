import process from "node:process";
import { randomUUID } from "node:crypto";

import { p as resolveAgentWorkspaceDir, m as resolveDefaultAgentId } from "/opt/homebrew/lib/node_modules/openclaw/dist/agent-scope-CYXg_wTS.js";
import { c as loadConfig } from "/opt/homebrew/lib/node_modules/openclaw/dist/io-DhtVmzAJ.js";
import { t as applyPluginAutoEnable } from "/opt/homebrew/lib/node_modules/openclaw/dist/plugin-auto-enable-CqpAn9Qh.js";
import {
  clearPluginCommands,
  executePluginCommand,
  getPluginCommandSpecs,
  loadOpenClawPlugins,
  matchPluginCommand,
} from "/opt/homebrew/lib/node_modules/openclaw/dist/plugins/build-smoke-entry.js";

function parseArg(name, fallback) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  if (!match) return fallback;
  return match.slice(prefix.length);
}

const commandBody = parseArg("--command", "");
if (!commandBody.trim()) {
  console.error("Usage: node scripts/native-plugin-smoke.mjs --command='/pilot ...' [--session-key=agent:main:smoke-native]");
  process.exit(1);
}

const sessionKey = parseArg("--session-key", "agent:main:smoke-native");
const sessionId = parseArg("--session-id", randomUUID());
const senderId = parseArg("--sender-id", "openclaw-control-ui");
const channel = parseArg("--channel", "webchat");
const channelId = parseArg("--channel-id", "webchat");
const from = parseArg("--from", "openclaw-control-ui");
const to = parseArg("--to", "openclaw-control-ui");
const accountId = parseArg("--account-id", "default");
const env = process.env;
const rawConfig = loadConfig();
const autoEnabled = applyPluginAutoEnable({
  config: rawConfig,
  env,
});
const config = autoEnabled.config;
const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
const logger = {
  info: (message) => console.error(`[plugin-smoke:info] ${message}`),
  warn: (message) => console.error(`[plugin-smoke:warn] ${message}`),
  error: (message) => console.error(`[plugin-smoke:error] ${message}`),
  debug: (message) => console.error(`[plugin-smoke:debug] ${message}`),
};

clearPluginCommands();
const registry = loadOpenClawPlugins({
  config,
  activationSourceConfig: rawConfig,
  autoEnabledReasons: autoEnabled.autoEnabledReasons,
  workspaceDir,
  env,
  logger,
  cache: false,
  activate: true,
  loadModules: true,
});

const specs = getPluginCommandSpecs();
const match = matchPluginCommand(commandBody);

if (!match) {
  console.error(JSON.stringify({
    ok: false,
    reason: "no_plugin_command_match",
    commandBody,
    workspaceDir,
    loadedPlugins: registry.plugins.map((plugin) => ({
      id: plugin.id,
      status: plugin.status,
      commands: plugin.commands,
      source: plugin.sourcePath,
    })),
    registeredCommands: specs.map((spec) => ({
      name: spec.name,
      pluginId: spec.pluginId,
      description: spec.description,
    })),
  }, null, 2));
  process.exit(2);
}

const result = await executePluginCommand({
  command: match.command,
  args: match.args,
  senderId,
  channel,
  channelId,
  isAuthorizedSender: true,
  gatewayClientScopes: ["operator.admin", "operator.read", "operator.write"],
  sessionKey,
  sessionId,
  commandBody,
  config,
  from,
  to,
  accountId,
});

console.log(JSON.stringify({
  ok: true,
  workspaceDir,
  matchedCommand: {
    name: match.command.name,
    pluginId: match.command.pluginId,
    acceptsArgs: match.command.acceptsArgs,
    args: match.args ?? null,
  },
  result,
}, null, 2));
