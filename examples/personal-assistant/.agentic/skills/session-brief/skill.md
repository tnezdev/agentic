---
name: session-brief
description: Activate when an agent needs to start or resume a personal assistant session from durable context
tags: [personal-assistant, continuity, artifact]
---

# Session Brief

Use this procedure when the task is to reconstruct the current assistant context and produce a startup briefing.

## Procedure

1. Read the user profile and assistant operating rules.
2. Read the operating policy so source limits and live-access claims are explicit.
3. Read the continuity brief as the base picture.
4. Read the most recent session artifacts and let them override stale continuity.
5. Read open loops and identify ready work, blocked work, waiting items, and items needing the user.
6. Read workspace context if the task names a work target or input artifact for it.
7. Synthesize a concise briefing. Prefer current state over chronology.
8. Write a `session-brief` artifact. Keep it readable without the transcript.
9. If no explicit work target exists, end with one direct question.

## Artifact Contract

Write a `session-brief` artifact with these sections:

- `Who This Assistant Is`
- `Current Picture`
- `Last Session`
- `Open Work`
- `Needs User`
- `Recommended Next Step`
- `Sources Consulted`

The artifact should name the source artifacts it consulted. It should not claim live service state unless the harness actually checked that service during the turn.

Finalize the artifact once it is coherent enough to serve as durable continuity for the next session. Finalization means the brief is the accepted output for this pass, not that it can never be superseded.

## Quality Bar

- A reader can understand the current picture without reading the whole transcript.
- Recent sessions override stale continuity where they conflict.
- Blockers and user-needed decisions are explicit.
- The recommended next step is small enough to start now.
- Assumptions are labeled instead of hidden in confident prose.
