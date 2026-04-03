# Contributing to OpenClaw Pilot

Thanks for contributing.

## What we value

- Clear scope
- Backwards-compatible behavior
- Good observability
- Small, reviewable changes
- Reliable continuation behavior for `/pilot` and `/pilot next`

## Development workflow

```bash
pnpm install
pnpm typecheck
pnpm test -- --runInBand
```

## Pull request guidelines

Please keep PRs narrow.

Good PRs:
- fix a continuation edge case,
- improve structured output recovery,
- improve locale behavior,
- improve runtime hygiene,
- add focused tests.

Avoid mixing these into one PR:
- product copy changes,
- host integration changes,
- schema changes,
- and unrelated refactors.

## Tests

Every behavior change should ship with at least one regression test.

Especially important areas:
- `/pilot` vs `/pilot next`
- two-message delivery contract
- locale-following behavior
- professionalizer fallback behavior
- bounded syntax recovery

## Reporting bugs

Please include:
- the command you sent,
- expected behavior,
- actual behavior,
- relevant logs,
- and whether the issue happened in a clean runtime.
