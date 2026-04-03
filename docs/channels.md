# Channels

The plugin is channel-agnostic by design. It does not hardcode WebUI, Telegram, or any other chat surface.

## Why WebUI and Telegram share the same path

- WebUI chat is exposed by OpenClaw as the internal `webchat` channel.
- Telegram is a first-class OpenClaw channel with the same Gateway/session routing model.
- The plugin reads normalized command context, session metadata, and recent session messages from OpenClaw runtime APIs rather than from a channel-specific UI layer.
- That means `/pilot` works the same way everywhere OpenClaw can route a command into the Gateway.

## Triggering

- WebUI Chat: type `/pilot <simple command>` directly in chat.
- Telegram: send the same slash command text.
- Other channels: use the same `/pilot` syntax as long as the channel is wired into OpenClaw's command pipeline.

## Channel-specific notes

- Telegram can also use native command delivery, but the plugin does not depend on Telegram-only UX.
- WebUI uses the shared text-command path, so it exercises the same professionalizer and risk gate logic as Telegram.
