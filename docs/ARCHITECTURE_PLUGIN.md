# Architecture

`openclaw-command-pilot-plugin` is an OpenClaw native plugin that acts as a
pre-execution orchestrator, not a cosmetic prompt rewriter.

## What it uses today

The current implementation uses real OpenClaw plugin surfaces that exist in
2026.3.31:

- `api.registerCommand(...)` for `/pilot`
- `api.on("before_prompt_build", ...)` for standing-order injection
- `api.runtime.subagent.getSessionMessages(...)` for recent session history
- `api.runtime.subagent.run(...)` and `waitForRun(...)` for execution handoff
- `api.runtime.state.resolveStateDir()` for persistent approval records

That means the same plugin logic can run from WebUI Chat, Telegram, and any
other OpenClaw channel that resolves into the same Gateway/session path.
Channel-specific details are normalized at the plugin boundary, not baked into
the core policy logic.

## Main flow

1. Parse `/pilot` and its mode flags.
2. Collect session context and recent conversation history.
3. Classify risk before any rewrite.
4. Rewrite the request into a structured execution brief.
5. Re-classify the rewritten output using the risk policy.
6. Either hand off to OpenClaw execution or store a confirmation token.

## Professionalizer policy

The professionalizer converts rough commands into a stable object with:

- `normalized_intent`
- `goal`
- `scope`
- `constraints`
- `deliverables`
- `execution_mode`
- `risk_level`
- `need_confirmation`
- `optimized_instruction`
- `actionable_steps`

The plugin prefers a JSON-producing LLM pass, but the current stable fallback is
heuristic professionalization plus schema validation. This is deliberate: it
keeps the plugin useful even when a structured-output path is unavailable or
fails validation.

## Rewrite policy

Rewrite should preserve user intent while making hidden assumptions explicit.
The rewrite rules are:

- Keep the smallest useful scope.
- Convert vague requests into audit-first or plan-first steps.
- Preserve constraints like "do not touch backend".
- Make deliverables explicit so the execution layer has something concrete to do.
- Never soften destructive language into safe-looking text.

## Risk classification logic

Risk is computed twice:

- Before rewrite, to detect obviously dangerous requests.
- After rewrite, to catch dangerous implications introduced by the normalized plan.

The policy file uses keyword rules with actions:

- `allow` for low-risk actions
- `confirm` for anything destructive, remote, or production-facing
- `block` for actions that should never be silent

High-risk intercepts include:

- file or directory deletion
- bulk overwrite and mass rename
- `git push` and force push
- remote/origin changes
- privilege escalation
- production deployment or production migrations

If the request is ambiguous, the plugin should default to confirmation.

## Few-shot guidance

Low-risk example:

```text
/pilot 把 OCAX 首页和 roles 页统一成 linear 风格，先审计再改，不要动后端
```

Expected behavior:

- `goal`: unify the UI style
- `scope`: homepage and roles page only
- `constraints`: audit first, do not touch backend
- `risk_level`: low or medium
- `need_confirmation`: false unless the agent discovers destructive side effects

Confirmation-required example:

```text
/pilot 帮我把 OCAX 目录里没用的旧文件都清理掉
```

Expected behavior:

- convert to inventory first
- produce a cleanup report
- wait for confirmation before deletion
- `risk_level`: high

Git/remote example:

```text
/pilot 帮我把当前项目直接推到远程主分支
```

Expected behavior:

- classify as critical
- require confirmation
- never auto-run silently

## Current capability vs degradation

Current capability:

- command registration
- typed lifecycle hooks
- session history access through the runtime
- execution handoff through subagent runtime

Degraded path:

- if a structured-output LLM path fails, the plugin falls back to heuristic
  professionalization
- if session history cannot be fetched, the plugin still rewrites using only the
  current command and standing orders
- if a command is high-risk, the plugin stores a confirmation token instead of
  executing directly

