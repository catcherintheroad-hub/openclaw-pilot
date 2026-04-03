# Release Announcement Draft

## Short version

OpenClaw Pilot is live.

It turns a vague idea into:
- a structured planning response for humans, and
- a clean execution packet for OpenClaw.

Instead of writing long fragile prompts by hand, you can use `/pilot` to compile work into something the agent can actually use.

## Longer version

Most people do not fail with OpenClaw because the model is weak.
They fail because the task is underspecified.

OpenClaw Pilot helps with that.

It takes a simple command, builds a scoped plan, persists a `pilot_id`, supports continuation with `/pilot next`, and can split the result into a human-facing plan plus a machine-ready execution packet.
