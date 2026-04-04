# openclaw-command-pilot-plugin

`openclaw-command-pilot-plugin` compiles rough ideas into an executable blueprint and a clean OpenClaw execution packet.

> Current packaging direction: ship the behavior contract first via a public `OpenClaw Pilot` skill shell, then add heavier plugin/distribution layers only where they add real value.

Validated against OpenClaw `2026.3.31`.

## Import hygiene

This project has been checked for deprecated root imports. There are no `openclaw/plugin-sdk` root imports; all SDK imports use the supported subpath form:

- `openclaw/plugin-sdk/core`

## What it uses

- `api.registerCommand(...)` for `/pilot`
- `api.on("before_prompt_build", ...)` for standing-order injection
- `api.runtime.subagent.getSessionMessages(...)` for recent session context
- `api.runtime.subagent.run(...)` and `waitForRun(...)` for execution handoff
- `api.runtime.agent.runEmbeddedPiAgent(...)` for structured professionalization

## Approval semantics

There are two approval layers:

- Command Pilot preflight approval: `/pilot confirm <id>` or `/pilot cancel <id>`
- Official OpenClaw exec approval after handoff: `/approve <id> allow-once|allow-always|deny`

Current OpenClaw `2026.3.31` exposes official `/approve` for exec approvals through `approvals.exec`. It does not expose a generic plugin-level `approvals.plugin` surface for arbitrary native plugin command gates. This plugin therefore keeps a narrow preflight approval for its own risk gate, while remaining compatible with official `/approve` if downstream execution triggers exec approval.

## Minimal runnable config

```json5
{
  plugins: {
    entries: {
      "command-pilot": {
        enabled: true,
        hooks: {
          allowPromptInjection: true
        },
        config: {
          defaultMode: "preview",
          recentTurns: 8,
          maxHistoryMessages: 12,
          allowAutoRunUpTo: "low"
        }
      }
    }
  },
  approvals: {
    exec: {
      enabled: true,
      mode: "session"
    }
  }
}
```

Notes:

- `plugins.entries.command-pilot.enabled` is required.
- `plugins.entries.command-pilot.hooks.allowPromptInjection` is recommended. If `false`, `/pilot` still works, but standing-order injection via `before_prompt_build` is skipped.
- `approvals.exec` is the real current OpenClaw approval-forwarding config. `approvals.plugin` is not a current host key in `2026.3.31`.

## Install

```bash
cd /Users/jiahuiwu/Desktop/指令优化/openclaw-command-pilot-plugin
pnpm install
pnpm test
pnpm build
openclaw plugins install -l /Users/jiahuiwu/Desktop/指令优化/openclaw-command-pilot-plugin
openclaw gateway restart
```

## Dry-run commands

- WebUI Chat:
  `/pilot 把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端`
- Telegram:
  `/pilot 把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端`

Expected:

- command triggers successfully
- recent session context is reflected in the brief when available
- low-risk requests show a preview and can hand off
- higher-risk requests stop at the preflight approval gate
- if downstream OpenClaw exec approval is triggered, official `/approve` remains the resolver

## Quick start

> Note: the public `OpenClaw Pilot` skill shell is the recommended first release artifact. The native plugin in this repo is the implementation base, not a claim that ClawHub users will automatically get the full plugin install/runtime flow from the skill alone.


### Shortest demo

```text
/pilot Build a lightweight OpenClaw workflow that turns vague ideas into execution-ready packets, but keep the first release minimal and scope-controlled.
```

Expected reply shape:

1. a first message with real user value
   - project-style requests: a human-readable blueprint
   - content/marketing/script-style requests: a ready-to-use deliverable first
2. a separate pure `[OPENCLAW_EXECUTION_PACKET v1] ... [END_OPENCLAW_EXECUTION_PACKET]` message

That two-message behavior is the main publishable contract for the public beta skill shell.

### Before / after

- **Before:** rough idea mixed with assumptions and hidden scope drift, or content requests getting forced into empty blueprint shells
- **After:** either a scoped blueprint or a ready-to-use content deliverable first, plus a packet-only handoff message and `/pilot next <pilot_id> ...` continuation path

## Docs

- [Installation](./docs/installation.md)
- [Architecture](./docs/architecture.md)
- [Configuration](./docs/configuration.md)
- [Channels](./docs/channels.md)
- [Handoff](./docs/handoff.md)
