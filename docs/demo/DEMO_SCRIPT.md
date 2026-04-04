# OpenClaw Pilot Demo Script

## Goal

Show how OpenClaw Pilot turns a vague request into:

1. a readable blueprint
2. a separate pure execution packet
3. a continuation flow with `/pilot next <pilot_id> ...`

## Demo flow

1. Start with a vague product/build request
2. Show the first blueprint reply
3. Show the second packet-only reply
4. Feed back a blocker or result through `/pilot next <pilot_id> ...`
5. Show that continuation still returns the same two-message contract

## Key talking points

- contract clarity beats prompt soup
- the packet is clean enough to hand directly to OpenClaw
- continuation does not require restating the whole project
- the first public release is intentionally minimal and behavior-first

## Placeholder media note

Replace this script with a recorded GIF/video walkthrough when public demo assets are ready.