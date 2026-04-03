# Architecture

## High-level flow

1. User sends `/pilot ...`
2. Pilot professionalizes intent into structured state
3. Pilot persists state with `pilot_id`
4. Pilot renders:
   - human-readable planning output
   - machine-ready execution packet
5. User can continue with `/pilot next <pilot_id> ...`

## Core layers

### 1. Intent intake
Reads the current command and extracts:
- project goal
- current constraints
- scope boundaries
- requested stage behavior

### 2. Professionalizer
Attempts structured output generation using configured candidate models.

Important reliability features:
- candidate fallback chain
- auth-skipped handling
- bounded syntax recovery
- post-processing repair
- minimal-fallback safety path

### 3. State/orchestration
Maintains:
- `pilot_id`
- current stage
- output language
- continuation context

### 4. Renderer
Builds:
- A/C/D human-facing output
- B execution packet

### 5. Delivery
Preferred UX:
- Message 1: A/C/D
- Message 2: pure execution packet

## Non-goals

- unrestricted JSON self-healing
- replacing the execution agent itself
- domain-specific business logic for every industry
