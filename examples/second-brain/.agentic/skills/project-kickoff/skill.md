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

Ask about:

- Outcome: What should be true when this project is done?
- Motivation: Why does this matter now?
- Scope: What is in bounds, and what is explicitly out of bounds for the first pass?
- Constraints: Are there deadlines, tools, people, budgets, or standards to respect?
- Current state: What already exists, and where is the messy input coming from?
- Success criteria: How will we know this worked?
- First useful action: What would create momentum without overbuilding?

If the user already gave enough context, summarize your assumptions and ask for confirmation before creating durable artifacts. If the user explicitly asks for a speculative draft, label assumptions clearly.

## PARA Placement

Choose a concrete project bucket tag:

```text
para:project/<slug>
```

If the work is ongoing with no completion point, suggest an area tag instead:

```text
para:area/<slug>
```

If it is reference material without an active outcome, suggest a resource tag:

```text
para:resource/<slug>
```

## Project Plan Artifact

After intake, write a `project-plan` artifact with:

- Outcome
- Why It Matters
- Success Criteria
- Scope
- Constraints
- Current State
- PARA Bucket
- Milestones or Intermediate Packets
- Risks
- Current Next Actions

Every project plan must include a `para:project/<slug>` tag unless the intake reveals it is not actually a project.

## Next Actions

Next actions should respect dependencies. Do not choose a later action if an earlier structure does not exist yet.

For example, if the project is to create a reading queue, do not pick the first reading item until the queue surface, fields, and statuses exist. The better next action is to define the queue shape from the user's requirements.
