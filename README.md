# OpenClaw Pilot

**OpenClaw Pilot — 把模糊想法编译成可执行的 AI 工作指令。**

OpenClaw Pilot is a source-first OpenClaw plugin that turns vague goals into structured, executable work instructions.

Instead of asking users to handcraft long, brittle prompts, Pilot compiles a rough objective into:

1. a human-readable planning message, and
2. a separate machine-ready execution packet that can be sent to OpenClaw.

## Why this exists

Many OpenClaw users do not fail because the model is weak. They fail because the task is underspecified.

A typical input looks like this:

> “I want an MVP for AI document checking for cross-border e-commerce sellers. Keep it small.”

That is enough for a human collaborator, but not enough for a reliable agent run.

OpenClaw Pilot bridges that gap by turning fuzzy intent into:

- a scoped plan,
- a stage-aware continuation flow,
- a reusable `pilot_id`, and
- a ready-to-send execution packet.

## Core capabilities

- **`/pilot` for new work**  
  Compiles a new idea into a structured stage plan.
- **`/pilot next <pilot_id>` for continuation**  
  Continues the same project without opening a new direction.
- **Two-message delivery**  
  Message 1: human-facing A/C/D output.  
  Message 2: pure OpenClaw execution packet for copy/paste.
- **Chinese-first locale following**  
  Chinese input defaults to Chinese output, including labels and packet text.
- **Professionalizer stability hardening**  
  Structured output repair, bounded syntax recovery, fallback classification, and runtime observability.
- **Runtime hygiene**  
  Runtime fingerprinting, stale-listener detection, and debug-gated locale tracing.

## Example

### Input

```text
/pilot 我想做一个针对跨境电商卖家的 AI 单证核对 MVP，只覆盖合同、发票、装箱单三类文档的自动比对。先不要执行，先给我一个最小可行版本的规划。
```

### Output behavior

**Message 1**
- A. Command Pilot 蓝图
- C. 应回传给 /pilot 的内容
- D. 下一条命令

**Message 2**
- `[OPENCLAW_EXECUTION_PACKET v1]`
- machine-ready packet body
- `[END_OPENCLAW_EXECUTION_PACKET]`

## What Pilot is not

OpenClaw Pilot is **not**:

- a generic prompt beautifier,
- a one-shot template library,
- a workflow engine for every use case,
- or a replacement for implementation work.

It is a **planner/compiler layer** that helps users hand off work to OpenClaw in a more structured and repeatable way.

## Repository status

This repository is being prepared for public release from an actively developed local plugin codebase.

Current release goals:

- stable `/pilot` new-task flow,
- stable `/pilot next` continuation flow,
- two-message delivery,
- Chinese locale support,
- professionalizer recovery and observability,
- and GitHub-ready documentation.

## How it works

At a high level, Pilot does four things:

1. **Interpret** the user’s intent.
2. **Professionalize** it into a structured internal representation.
3. **Persist** stage-aware state using a `pilot_id`.
4. **Render** both a human-readable planning response and a machine-ready execution packet.

## Suggested repo structure

```text
openclaw-pilot/
├─ src/
├─ config/
├─ test/
├─ docs/
├─ examples/
└─ .github/
```

## Installation

This project currently assumes a **source-first local plugin workflow**.

If you are already running the plugin locally, keep using your current OpenClaw plugin registration workflow and point the plugin entry to the repository’s `src/index.ts`.

Suggested local development flow:

```bash
pnpm install
pnpm typecheck
pnpm test -- --runInBand
```

## Development notes

- Keep host integration changes minimal.
- Prefer backwards-compatible reply contracts.
- Treat runtime hygiene and observability as product requirements, not just debugging conveniences.
- Do not expand prompt repair logic into unrestricted free-form mutation.

## Launch checklist

See:

- [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`ROADMAP.md`](ROADMAP.md)
- [`PUBLISH_TO_GITHUB.md`](PUBLISH_TO_GITHUB.md)

## FAQ

### Why not just write better prompts manually?

Because most users do not want to manually maintain long, structured, stage-aware prompts for every task.

### Why split the output into two messages?

Because humans want readable guidance, while agents want a clean execution packet.

### Is this only for OpenClaw?

The current implementation is built for OpenClaw. The underlying idea is more general: compile vague intent into executable agent work instructions.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).
