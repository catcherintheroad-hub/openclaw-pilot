# OpenClaw Pilot ClawHub Skill Release Plan

## Release decision

### Why a skill shell should ship first

At the current stage, OpenClaw Pilot is strongest as a behavior contract product, not as a heavy host-integration product.

The repo already has real `/pilot` orchestration logic, packet rendering, continuation flow, and tests. The highest-value public promise today is:

- compile rough ideas into an executable blueprint
- emit a clean OpenClaw execution packet in a separate message
- continue the same pilot with `/pilot next <pilot_id> ...`

That makes a skill-shell release the best first move because it:

- exposes the core user value with minimal packaging risk
- avoids overcommitting to plugin/distribution complexity too early
- keeps the public surface instruction-first and dependency-light
- lets the team validate demand for the contract before building a heavier companion layer

### What this first beta release promises

- a clear public positioning for OpenClaw Pilot
- strict two-message output contract guidance
- continuation semantics through `/pilot next <pilot_id> ...`
- examples for new-project flow, continuation flow, and output contract

### What this first release does not promise

- one-click plugin installation as the primary distribution mode
- rich host integration as the headline feature
- external local binaries or environment bootstrapping
- expanded automation beyond the current contract-centered experience

### Future plugin companion boundary

If a plugin companion is added later, its job should be narrow:

- host registration of `/pilot`
- runtime persistence for pilot state and approvals
- optional richer integration with OpenClaw sessions

It should not redefine the public skill contract. The public contract remains the two-message behavior and continuation model.

## Minimum release path

1. Prepare local skill directory
   - `skills/openclaw-pilot/SKILL.md`
   - examples
   - `.clawhubignore`
2. Verify reply contract locally
   - confirm `/pilot` returns two messages
   - confirm `/pilot next` returns two messages
   - confirm message 2 is packet-only
3. Run repo tests
4. Review public wording for accuracy
5. Check ClawHub-facing metadata
   - name
   - slug
   - short description
   - long description
   - tags
   - version
6. Dry-check publish readiness
   - no secret paths in docs
   - no false capability claims
   - examples match current implementation
7. Publish only after explicit authorization and credential readiness

## Pre-publish checklist

- [ ] skill folder present and readable
- [ ] output contract documented in `SKILL.md`
- [ ] examples cover new project, continuation, and output contract
- [ ] `.clawhubignore` excludes build/dev noise
- [ ] contract tests pass locally
- [ ] listing copy reflects current real capability
- [ ] known limitations are documented

## Post-publish install validation

After publish, validate the public package by checking:

1. the skill installs cleanly from ClawHub as a skill artifact
2. `SKILL.md` renders clearly in listing/install flow
3. examples remain readable after packaging
4. users can understand the two-message contract without reading internal docs
5. continuation usage is discoverable from the listing copy
6. the listing does not imply that the skill alone delivers the full native plugin/runtime installation path

## Non-goals for this release

- remote publishing during this task
- release creation
- push to remote
- broad repo restructuring
