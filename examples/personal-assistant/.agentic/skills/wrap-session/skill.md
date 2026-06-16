---
name: wrap-session
description: Activate when an agent needs to close a personal assistant session and preserve continuity for the next turn
tags: [personal-assistant, continuity, artifact]
---

# Wrap Session

Use this procedure when the assistant has completed meaningful work or the user is ending the session.

## Procedure

1. Identify what changed during the session: decisions, artifacts created or updated, workflow runs advanced, and task state changes.
2. Separate durable facts from transcript chatter. Do not preserve every step.
3. Update or draft the next continuity picture if the current state changed.
4. Update open loops: ready, blocked, waiting, and needs-user.
5. Write a `session-wrap` artifact with a next-session pointer.
6. If the harness has live integrations, name which ones were checked. If not, state that the wrap only reflects workspace context and the current transcript.
7. End with either a concise completion note or one blocker that needs user input.

## Artifact Contract

Write a `session-wrap` artifact with these sections:

- `What Happened`
- `Decisions`
- `Durable Changes`
- `Open Loops`
- `Next Session Pointer`
- `Sources Consulted`

The artifact should be short enough to read at the start of the next session. It should point to durable artifact ids rather than copying full content.

Finalize the artifact when it is coherent enough to serve as the next session's freshest note.

## Quality Bar

- A future assistant can resume from the wrap without the transcript.
- The wrap distinguishes completed work from proposed follow-ups.
- Blockers are explicit and assigned to either the assistant, the user, or the harness.
- The next-session pointer names exactly where to start.
