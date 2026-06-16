---
name: project-kickoff
description: Activate when an agent needs to turn a project idea into a scoped PARA project without guessing the user's intent
tags: [second-brain, project, para, intake]
---

# Project Kickoff

Use this procedure when the user wants to start or shape a project in a second-brain workspace.

## Principles

- Organize by actionability. A project exists to support a concrete outcome, not to classify information by broad subject.
- A project is a short-term effort with a goal. If it has no finish line, it is probably an area, resource, or habit instead.
- Do not draft a project plan from a title alone. First gather enough intent to avoid creating plausible but wrong tasks.
- Keep the first plan lightweight. The goal is clarity and movement, not a perfect system.
- End with the next essential step, not an exhaustive backlog.

## Intake First

Before creating a `project-plan` artifact, ask concise questions. Prefer 3-5 questions at a time.

Ask about outcome, motivation, scope, constraints, current state, success criteria, and the first useful action.

If the user already gave enough context, summarize your assumptions and ask for confirmation before creating durable artifacts. If the user explicitly asks for a speculative draft, label assumptions clearly.

## PARA Placement

Choose a concrete project bucket tag:

```text
para:project/<slug>
```

If the work is ongoing with no completion point, suggest an area tag instead. If it is reference material without an active outcome, suggest a resource tag.

## Project Plan Artifact

After intake, write a `project-plan` artifact with outcome, why it matters, success criteria, scope, constraints, current state, PARA bucket, milestones, risks, and current next actions.

Every project plan must include a `para:project/<slug>` tag unless the intake reveals it is not actually a project.
