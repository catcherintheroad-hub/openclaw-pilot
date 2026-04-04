# OpenClaw Pilot Public Beta Notes

## Summary

This beta packages OpenClaw Pilot for public skill-style distribution with the smallest viable public surface.

The core value is not heavy host integration. The core value is the behavior contract:

- compile rough ideas into an executable blueprint
- emit a separate pure execution packet for OpenClaw
- continue the same pilot with `/pilot next <pilot_id> ...`

## What is included in this beta

- reply-contract coverage for new `/pilot` requests
- reply-contract coverage for `/pilot next` continuation requests
- a public `skills/openclaw-pilot/` skill shell
- examples for new project flow, continuation flow, and output contract
- ClawHub listing copy and release planning docs

## What changed in this round

- tightened contract tests around the two-message reply path
- locked continuation validation so packet text does not drift back into the human-readable message
- added a public-facing skill shell focused on instruction clarity
- added release docs for ClawHub-first packaging

## Known limitations

- `/pilot next` reply contract is now test-locked in the current repo, but should still be watched when renderer/delivery code changes
- the professionalizer has already received substantial stabilization work, but upstream model output wobble still needs monitoring
- the public skill shell documents and sells the behavior contract; it does not yet package the full native plugin experience as the main installation path

## Recommended validation before wider rollout

1. run the local orchestrator and reply-contract tests
2. verify both new and continuation paths still emit exactly two final user-visible messages
3. manually spot-check Chinese input behavior
4. verify public docs do not promise host capabilities that are not yet productized
