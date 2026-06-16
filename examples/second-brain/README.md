# Second-Brain Research Example

This example shows Agentic as a small research operating system: personas, skills, workflows, a task queue, and finalized artifacts.

It is intentionally personal-workflow shaped rather than product-demo shaped. The point is not to automate research end-to-end. The point is to give an agent enough durable structure to pick up a question, preserve useful findings, and produce a reusable brief without turning Agentic into a host runtime.

## Big Picture

Agentic is the primitive layer. It stores and loads the pieces an agent needs inside a turn, but it does not call the model or execute research by itself.

In this example:

- The harness reads `AGENTS.md` to learn how to enter the workspace.
- The harness activates the `researcher` persona and gives that output to the model.
- The agent uses `task next` and `skill run` to gather working context.
- The agent uses the `research-loop` workflow to keep multi-step research resumable.
- The agent writes the final answer as an artifact so the result survives beyond the transcript.

The host harness still owns model calls, tool execution, browsing, credentials, approvals, scheduling, and user communication.

## Run It Locally

From the repo root:

```bash
agentic runtime init local --base-dir examples/second-brain
agentic runtime run examples/second-brain
```

That is the current runnable path for this example. It uses the public runtime
target, `local`, and the repo-local `agentic` shim discovers
`packages/agentic-runtime-local` from this checkout.

If Pi is installed and you want the local runtime to hand the prepared turn to a
real harness, use the same public target with an explicit harness flag:

```bash
agentic runtime run examples/second-brain --harness pi
```

You can also run the workflow explicitly from inside the example workspace:

```bash
agentic runtime init local --base-dir .
agentic runtime run research-loop --base-dir .
```

The local runtime does not browse, call a model, or complete the research for
you. It prepares the workspace for harness execution by loading the selected
persona, skills, ready task, and workflow; creating a workflow run; starting the
entry node; recording a runtime invocation; and writing a finalized
`local-runtime-run` artifact as the durable run packet. With `--harness pi`, it
then invokes the Pi CLI in print mode with generated prompt files and records the
Pi session reference on the invocation.

After `runtime run`, inspect the IDs printed in the command output:

```bash
agentic workflow status <workflow-run-id> --base-dir examples/second-brain
agentic artifact read <artifact-id> --base-dir examples/second-brain
agentic artifact inspect <artifact-id> --base-dir examples/second-brain
```

Those commands are also written into the run-packet artifact with an absolute
`--base-dir`, so the packet remains pasteable from anywhere.

Running the example creates local state under `.agentic/runtime/`,
`.agentic/runs/`, and `.agentic/artifacts/`. Runtime invocation records live in
`.agentic/runtime/local/invocations/`; they link the runtime command to the
workflow run and artifact without storing a model transcript. Use a throwaway
copy if you want to keep a repository checkout clean. Pi harness runs also create
prompt files beside the invocation JSON and session state under
`.agentic/runtime/local/pi-sessions/`.

## Inspect The Primitives

To inspect the same pieces manually without preparing a runtime run, use:

```bash
agentic persona activate researcher --base-dir examples/second-brain
agentic skill run research-brief --base-dir examples/second-brain
agentic workflow list --base-dir examples/second-brain
agentic task next --base-dir examples/second-brain
agentic artifact list --base-dir examples/second-brain
```

If you need to bypass the repo-local shim, use
`bun packages/agentic/src/cli/main.ts` from the repo root.

Agent harnesses should start with [`AGENTS.md`](AGENTS.md). It contains the minimal bootstrap instructions for when and how to call Agentic primitives inside this workspace.

## Package Starter Path

The packaged user story this example is proving is:

```bash
bun add @tnezdev/agentic
agentic init --example second-brain

bun add -d @tnezdev/agentic-runtime-local
agentic runtime add local
agentic runtime init local
agentic runtime run research-loop
```

`agentic init --example second-brain` scaffolds a starter workspace with the
researcher persona, required skills, the `research-loop` workflow, a seed task,
and a seed artifact. This repository directory remains the richer source example
for documentation and dogfooding.

## How The Pieces Work Together

### Harness Bootstrap

`AGENTS.md` is not an Agentic primitive. It is a harness convention: a short file that tells an agent how to use this workspace.

It answers the questions a generic harness needs at startup:

- Which base directory should Agentic commands use?
- Which persona should activate first?
- Which task and skill should be loaded?
- What is Agentic responsible for, and what does the harness still own?
- What must be true before an artifact is finalized?

### Persona

`.agentic/personas/researcher.md` is the agent's operating mode for this workspace.

It declares:

- `memory_tags`: which memories are relevant to recall.
- `skills`: which procedures are likely useful.
- `task_filter`: which tasks belong to this hat.
- `workflow`: the default workflow for this kind of work.
- Body text: the actual instructions rendered into context at activation time.

Running `persona activate researcher` prints the rendered persona. A harness should treat that output as prompt/context for the turn.

### Skill

`.agentic/skills/research-brief/skill.md` is the reusable procedure for producing a research brief.

It tells the agent how to move from open question to durable answer, including the expected artifact sections and the requirement to validate PARA taxonomy before finalization.

Skills are loaded on demand. They keep repeated procedures out of a bloated always-on system prompt.

### Memory

Agentic supports memory, but this public example does not ship with `.agentic/memory/*.json` records.

That is intentional. Memory is user-space: users may bring their own memories, storage adapters, and retention rules. A harness using this workspace can still call `memory recall` when user memory is configured, but the example itself keeps durable example output in artifacts.

Memories are not a transcript. They are compact facts the user wants the agent to remember across sessions.

### Task

`.agentic/tasks/*.json` stores open work.

The seeded task gives the agent a concrete research question to pick up. In a real second-brain workspace, tasks would be the research questions, decisions, or follow-ups that should not disappear between turns.

### Workflow

`.agentic/workflows/*.json` contains stateful processes for repeated second-brain operations.

The research workflow is:

```text
frame-question
→ gather-sources
→ write-brief
→ validate-taxonomy
→ finalize-brief
→ decide-next-actions
```

The important part is the review gate:

- `write-brief` creates or updates the draft research artifact.
- `validate-taxonomy` confirms the artifact has a valid PARA bucket tag.
- `finalize-brief` finalizes the artifact only after validation passes.

This is intentionally workflow-enforced rather than globally enforced by Agentic. Second-brain taxonomy rules are user- and workspace-specific, so the example encodes them in the workflow, skill, and harness instructions.

This example also includes other common second-brain workflows:

| Workflow | Use it when |
|---|---|
| `research-loop` | Turning an open question into a durable research brief |
| `project-kickoff` | Turning an idea into a scoped PARA project with next actions; starts with user intake questions |
| `project-archive` | Closing a project, preserving lessons, and reclassifying useful material |
| `weekly-review` | Reviewing active commitments and choosing next-week focus |
| `monthly-review` | Reviewing the project/area/resource portfolio and choosing next-month focus |
| `yearly-review` | Synthesizing the year and choosing next-year direction |
| `process-inbox` | Routing uncategorized captures into tasks, memories, artifacts, or PARA buckets |

### Artifact

`.agentic/artifacts/*` stores durable outputs.

The seed artifact is a finalized `research-brief`. It demonstrates the expected output shape and the required PARA tag convention:

```text
para:<bucket>/<slug>
```

Allowed buckets are:

- `project`
- `area`
- `resource`
- `archive`

Example tags:

- `para:project/reading-queue-refresh`
- `para:area/personal-finance`
- `para:resource/cellular-plans`
- `para:archive/old-research`

Finalization means the artifact is durable output for this research pass. It does not mean the answer can never be superseded.

## What Is In Here

| Path | Primitive | Purpose |
|---|---|---|
| `AGENTS.md` | Harness bootstrap | Minimal instructions for agents using this workspace |
| `.agentic/personas/researcher.md` | Persona | Activates the research hat: question-first, source-aware, concise synthesis |
| `.agentic/skills/research-brief/skill.md` | Skill | Agent-facing procedure for turning a question into a cited brief |
| `.agentic/skills/project-kickoff/skill.md` | Skill | Agent-facing procedure for interviewing before drafting a project plan |
| `.agentic/workflows/*.json` | Workflow | Research, project, review, archive, and inbox operating loops |
| `.agentic/tasks/*.json` | Tasks | A real ready task seeded with an example research question |
| `.agentic/artifacts/*` | Artifact | A finalized sample brief showing the target output |

After `agentic runtime init local`, the local runtime also creates
`.agentic/runtime/local/runtime.json` plus `targets/` and `invocations/`
directories. After `agentic runtime run`, it creates an invocation record, a
workflow run, and a finalized `local-runtime-run` artifact. Those are runtime
outputs, not starter content.

## What Is Not Included Yet

- Daemon or service mode
- Scheduling
- Cloud-hosted or other remote deployment
- External artifact storage or sync
- Model calls, browsing, credentials, approvals, or tool execution

Pi can power the local runtime under the hood, but users should choose the public
`local` runtime target, not `runtime pi`.

This is the runnable slice of the broader second-brain example direction tracked
in [#100](https://github.com/tnezdev/agentic/issues/100). This README documents
the current local loop rather than duplicating that roadmap.

## Dogfooding Loop

To dogfood this example, use it for one real research question and watch for friction.

1. Activate the persona.
2. Load the task and skill.
3. Start or inspect a `research-loop` workflow run.
4. Do the research using whatever tools the harness provides.
5. Create or update a `research-brief` artifact.
6. Validate that the artifact has a `para:<bucket>/<slug>` tag.
7. Finalize the artifact.
8. Mark the task done or add follow-up tasks.

Good dogfood findings are not just better answers. They are also places where the primitive boundaries feel wrong, missing, or too ceremonial.

## Why This Shape

Second-brain work repeats. The questions change, but the operating shape stays stable:

- Activate a persona so the agent knows how to think.
- Run a skill so the work procedure is explicit and reusable.
- Advance a workflow so multi-step work has state.
- Track tasks so open loops do not disappear.
- Write artifacts so the output becomes durable and inspectable.

Agentic owns those primitives. Your host runtime still owns browsing, credentials, model calls, scheduling, approvals, and notification surfaces.

## Extending It

Use this as a starter shape, not a template to preserve exactly.

- Add memories for your own source standards, output preferences, and active research areas.
- Add skills for recurring research genres: literature review, product comparison, meeting prep, or decision memo.
- Add workflow nodes only when they represent real state you need to resume later.
- Keep artifacts as the durable outputs; do not rely on a transcript as the source of truth.
