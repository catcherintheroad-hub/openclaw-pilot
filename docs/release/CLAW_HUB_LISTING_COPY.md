# OpenClaw Pilot — ClawHub Listing Copy

## Recommended package metadata

- **Name:** OpenClaw Pilot
- **Slug:** `openclaw-pilot`
- **Suggested current beta version:** `0.3.0-beta.2`

## One-line description (English)

Compile rough ideas into an executable blueprint and a clean OpenClaw execution packet.

## 中文副标题

把模糊想法编译成可执行蓝图与干净的 OpenClaw 执行包。

## Long description

OpenClaw Pilot helps compile rough ideas into an executable blueprint and a clean OpenClaw execution packet.

It is designed around a strict two-message contract:

1. a human-readable blueprint for the current stage
2. a separate pure `[OPENCLAW_EXECUTION_PACKET v1] ... [END_OPENCLAW_EXECUTION_PACKET]` block for OpenClaw

That means the user can inspect the plan, keep scope under control, and then hand a clean packet directly to OpenClaw without manually extracting instructions from mixed prose.

OpenClaw Pilot also supports continuation with `/pilot next <pilot_id> ...`, so a multi-stage project can keep moving forward without starting over each time.

The first public beta focuses on behavior quality and contract clarity, not on a heavy plugin/runtime packaging story.

## Use when

- you have a vague project idea and need an execution-ready plan
- you want AI instructions split cleanly from human explanation
- you need a stable continuation flow for multi-stage work
- you want a scope-controlled handoff into OpenClaw

## Suggested tags

- openclaw
- planning
- orchestration
- prompt-engineering
- workflow
- execution
- project-planning

## Positioning notes

### What users should expect

- blueprint-first planning
- packet-first execution handoff
- continuation with pilot IDs
- minimal setup burden for the public skill shell

### What users should not infer

- this is not yet a full heavy plugin platform story
- this is not a generic host automation suite
- this does not claim to eliminate all model-formatting variability
