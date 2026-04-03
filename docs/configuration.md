# Configuration

The plugin reads its runtime settings from `plugins.entries.command-pilot.config`
and its hard-risk policy from `config/risk-policy.json`.

## Plugin config

The config shape matches `src/config/schema.ts`.

```json5
{
  "defaultMode": "preview",
  "recentTurns": 8,
  "maxHistoryMessages": 12,
  "allowAutoRunUpTo": "low",
  "standingOrders": [
    "Preserve the user's scope exactly.",
    "Prefer audit-first behavior when the request is ambiguous.",
    "Do not touch backend or production-facing paths unless the user says so."
  ],
  "professionalizer": {
    "provider": "openai-codex",
    "model": "gpt-5.4",
    "thinking": "low",
    "temperature": 0.2,
    "maxTokens": 1200,
    "timeoutMs": 30000,
    "forceHeuristicFallback": false
  },
  "executor": {
    "strategy": "session-subagent",
    "waitTimeoutMs": 45000,
    "deliver": false
  },
  "confirmations": {
    "ttlMs": 3600000
  }
}
```

## Field behavior

- `defaultMode` controls what happens when the user types `/pilot <command>`
  without flags.
- `recentTurns` limits how much history is fed into the professionalizer.
- `maxHistoryMessages` caps the raw session fetch before trimming to
  `recentTurns`.
- `allowAutoRunUpTo` is the highest risk level that may auto-run.
- `standingOrders` are persistent guardrails appended to every rewrite pass.
- `professionalizer.forceHeuristicFallback` disables the LLM rewrite path and
  forces deterministic fallback behavior.
- `executor.strategy` is currently `session-subagent`; `embedded-fallback` is
  the supported fallback label for future adapter work.
- `confirmations.ttlMs` controls how long a confirmation token remains valid.

## Risk policy

The file `config/risk-policy.json` defines the default intercept rules.

Recommended defaults:

- delete, cleanup, rm -rf, purge
- git push, force push, rewrite history
- remote/origin changes
- sudo, root, permission escalation
- production, deploy, migration
- bulk overwrite, mass rename

The policy should treat unknown or ambiguous destructive language as
`confirm`, not `allow`.

## Current version vs downgrade

This version already supports:

- a real `/pilot` command
- session-aware context gathering
- a structured execution brief
- confirmation tokens for risky work

If the LLM rewrite path is unavailable or the JSON schema fails validation, the
plugin downgrades to heuristic professionalization. That keeps the output
structured even when model behavior is unreliable.

If session history cannot be loaded, the plugin still runs using:

- the current command
- the channel/session metadata
- the standing orders

## Usage examples

Low-risk UI request:

```text
/pilot 把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端
```

Cleanup request:

```text
/pilot 帮我把 OCAX 目录里没用的旧文件都清理掉
```

Remote write request:

```text
/pilot 帮我把当前项目直接推到远程主分支
```

For the cleanup and remote-write examples, the plugin should stop at preview or
confirmation-gated output instead of auto-running.

