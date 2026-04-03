# Installation

`openclaw-command-pilot-plugin` is a native OpenClaw plugin. It runs inside the same Gateway and session system that powers WebUI chat, Telegram, and other connected channels.

## Minimal install

```bash
cd <repo-root>
pnpm install
pnpm test
pnpm build
openclaw plugins install -l <repo-root>
openclaw gateway restart
```

## Minimal runtime config

Add the plugin entry in `~/.openclaw/openclaw.json`:

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

## Required and recommended keys

- Required: `plugins.entries.command-pilot.enabled`
- Recommended: `plugins.entries.command-pilot.hooks.allowPromptInjection`
- Recommended for downstream official `/approve`: `approvals.exec.enabled`

Current host note:

- `approvals.exec` is the real built-in approval-forwarding config in OpenClaw `2026.3.31`.
- `approvals.plugin` is not a current configuration key for arbitrary plugin command approvals.

## Approval model

- Command Pilot's own preflight gate uses `/pilot confirm <id>` and `/pilot cancel <id>`.
- Any later exec approval raised by OpenClaw after handoff uses the official `/approve <id> allow-once|allow-always|deny`.

## Dry-run checklist

1. WebUI Chat: run `/pilot 把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端`
2. Telegram: run the same `/pilot ...` command
3. Verify:
   - `/pilot` is recognized and returns a brief
   - recent context is reflected when the session has history
   - low-risk requests can hand off
   - higher-risk requests stop for preflight approval
   - downstream exec approvals, if any, arrive through official `/approve`

## Rollback

```bash
openclaw plugins disable command-pilot
openclaw gateway restart
```

If you installed via local link and want to remove it entirely:

```bash
openclaw plugins disable command-pilot
openclaw gateway restart
```

Then remove the `plugins.entries.command-pilot` block from `~/.openclaw/openclaw.json`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `/pilot` is treated as plain text | Plugin not enabled or gateway not restarted | Enable `plugins.entries.command-pilot.enabled` and restart gateway |
| Brief appears but standing orders are missing | `hooks.allowPromptInjection` is false | Set `plugins.entries.command-pilot.hooks.allowPromptInjection: true` |
| High-risk request never reaches official `/approve` | It is still in Command Pilot preflight approval | Use `/pilot confirm <id>` first |
| No chat-based official approval arrives after handoff | `approvals.exec.enabled` is off or channel approval routing is unset | Enable `approvals.exec`, plus Telegram/Discord exec approval routing if desired |
| Telegram works but WebUI does not | Gateway/webchat session not restarted or stale plugin state | Restart gateway and re-check `openclaw plugins list` |

## Runtime notes

- The plugin uses the native `registerCommand` surface for `/pilot`.
- It also uses `before_prompt_build` to inject standing orders into the system prompt when prompt mutation is allowed.
- If prompt injection is blocked by host policy, the command flow still works; only the standing-order prepend is skipped.
