# Handoff

This plugin is a pre-execution orchestration layer, not a prettified prompt helper.

## What it does now

- Parses `/pilot` commands.
- Reads recent session context through OpenClaw runtime APIs.
- Professionalizes the user's rough command into a structured brief.
- Classifies risk and blocks silent execution when confirmation is needed.
- Hands the optimized instruction back to OpenClaw through the subagent execution path.

## Approval-chain boundary

This plugin now documents and preserves the current OpenClaw approval boundary:

- Command Pilot preflight approval is local to the plugin and uses `/pilot confirm|cancel`
- official OpenClaw exec approval remains `/approve`

That means the plugin does not try to replace or fork the host approval system. It adds one narrow pre-handoff guard and then defers to OpenClaw's built-in approval system for any downstream exec approvals.

## Verified acceptance coverage

- UI/product redesign request: kept low risk, audit-first, no backend touch.
- Cleanup request: escalated to confirm-before-delete.
- Git push request: escalated to high/critical risk and required confirmation.
- Cross-channel path: same command flow is used for WebUI `webchat` and Telegram because both land in the same Gateway/session pipeline.

## Current downgrade points

- If the host does not allow prompt mutation, standing orders are not injected into the system prompt.
- If the structured LLM path fails, the plugin falls back to a heuristic JSON professionalizer.
- If session history is unavailable, the plugin still runs with the current command and metadata only.

## Next integration steps

1. Enable `plugins.entries.command-pilot.enabled` in `openclaw.json`.
2. Decide whether `plugins.entries.command-pilot.hooks.allowPromptInjection` should stay on.
3. Enable `approvals.exec` if you want downstream official `/approve` prompts in chat.
4. Verify `/pilot` in WebUI and Telegram with one low-risk and one high-risk sample.
