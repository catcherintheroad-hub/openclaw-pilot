# Example: output contract

## Required delivery contract

OpenClaw Pilot outputs exactly two assistant messages for planning/continuation replies.

### Message 1 — user-value-first

May include:

- for project-style requests: blueprint, feedback contract, next command, rationale
- for content-style requests: the actual deliverable first, such as a script, copy, or publish suggestions

Must not include the packet block.

### Message 2 — packet-only

Must contain only:

```text
[OPENCLAW_EXECUTION_PACKET v1]
...
[END_OPENCLAW_EXECUTION_PACKET]
```

Must not include:

- section headers like `A.`, `B.`, `C.`, `D.`
- explanatory prose
- continuation hints
- extra status text before or after the block

## Regression check

- `/pilot <goal>` must still return exactly two messages.
- project-style asks should keep blueprint-first semantics in message 1.
- content-style asks may switch message 1 to deliverable-first semantics.
- `/pilot next <pilot_id> <feedback>` must continue to honor the two-message contract with a separate packet-only second message.