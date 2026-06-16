# Second-Brain Research Example

This example shows Agentic as a small research operating system: personas, skills, workflows, a task queue, and durable artifacts.

It is intentionally personal-workflow shaped rather than product-demo shaped. The point is not to automate research end-to-end. The point is to give an agent enough durable structure to pick up a question, preserve useful findings, and produce a reusable brief without turning Agentic into a host runtime.

## Big Picture

Agentic is the primitive layer. It stores and loads the pieces an agent needs inside a turn, but it does not call the model or execute research by itself.

In this example:

- The harness reads `AGENTS.md` to learn how to enter the workspace.
- The harness asks `task next` for the workspace's current next action.
- The task names the persona, skill, workflow, and input artifacts to load.
- The harness activates the named persona and gives that output to the model.
- The agent uses the `research-loop` workflow to keep multi-step research resumable.
- The agent writes the final answer as an artifact so the result survives beyond the transcript.

The host harness still owns model calls, tool execution, browsing, credentials, approvals, scheduling, and user communication.

## Quick Smoke Test

This example is meant to be self-guided by its own second-brain content. Start
from the repo root and ask the workspace what is ready:

```bash
agentic task next --base-dir examples/second-brain
```

Then let the local runtime prepare that turn:

```bash
agentic runtime init local --base-dir examples/second-brain
agentic runtime run examples/second-brain
```

The runtime prints a workflow-run id and a run-packet artifact id. Inspect those
ids next:

```bash
agentic workflow status <workflow-run-id> --base-dir examples/second-brain
agentic artifact read <artifact-id> --base-dir examples/second-brain
```

That is the first-run path. It should show the loop without requiring you to
memorize artifact ids, persona names, or workflow internals first.

## Run It Locally

The local runtime uses the public runtime target, `local`, and the repo-local
`agentic` shim discovers `packages/agentic-runtime-local` from this checkout.
It does not browse, call a model, or complete the research for you. It prepares
the workspace for harness execution by loading the selected persona, skills,
ready task, and workflow; creating a workflow run; starting the entry node;
recording a runtime invocation; and writing a finalized `local-runtime-run`
artifact as the durable run packet.

If Pi is installed and you want the local runtime to hand the prepared turn to a
real harness, rerun the second command with an explicit harness flag:

```bash
agentic runtime run examples/second-brain --harness pi
```

You can also run the workflow explicitly from inside the example workspace:

```bash
agentic runtime init local --base-dir .
agentic runtime run research-loop --base-dir .
```

Running the example creates local state under `.agentic/runtime/`,
`.agentic/runs/`, and `.agentic/artifacts/`. Runtime invocation records live in
`.agentic/runtime/local/invocations/`; they link the runtime command to the
workflow run and artifact without storing a model transcript. Use a throwaway
copy if you want to keep a repository checkout clean. Pi harness runs also create
prompt files beside the invocation JSON and session state under
`.agentic/runtime/local/pi-sessions/`.

This checked-in example is a reusable fixture. Real harness runs are stateful:
they may mark the seed task done and create additional artifacts. This repository
ignores generated runtime state and new artifact directories under the example so
dogfood runs do not become fixture churn; a personal second-brain workspace can
choose to track or sync those durable artifacts instead.

## Manual Primitive Path

After the quick smoke test, inspect the same inputs manually:

```bash
agentic task show 01KTC500000000000000000001 --base-dir examples/second-brain
agentic artifact read 01KTC500000000000000000020 --base-dir examples/second-brain
agentic artifact read 01KTC500000000000000000030 --base-dir examples/second-brain
agentic artifact read 01KTC500000000000000000010 --base-dir examples/second-brain
```

Then load the exact primitives a manual harness would give to the model:

```bash
agentic persona activate researcher --base-dir examples/second-brain
agentic skill run research-brief --base-dir examples/second-brain
agentic workflow show research-loop --base-dir examples/second-brain
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
agentic task next

bun add -d @tnezdev/agentic-runtime-local
agentic runtime add local
agentic runtime init local
agentic runtime run research-loop
```

`agentic init --example second-brain` scaffolds a starter workspace with the
researcher and `second-brain-steward` personas, required skills, the
`research-loop` and `weekly-review` workflows, a self-guided seed task, and seed
artifacts for inbox captures, a reading queue, and a sample brief. This
repository directory remains the richer source example for documentation and
dogfooding.

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

`.agentic/personas/researcher.md` is the agent's operating mode for research
work in this workspace. `.agentic/personas/second-brain-steward.md` is the
curation hat for follow-up review tasks.

It declares:

- `memory_tags`: which memories are relevant to recall.
- `skills`: which procedures are likely useful.
- `task_filter`: which tasks belong to this hat.
- `workflow`: the default workflow for this kind of work.
- Body text: the actual instructions rendered into context at activation time.

Running `persona activate researcher` prints the rendered persona. A harness should treat that output as prompt/context for the turn.

### Skill

`.agentic/skills/research-brief/skill.md` is the reusable procedure for producing a research brief. `.agentic/skills/steward-review/skill.md` is the procedure for pruning, promoting, and turning leftovers into specific follow-up tasks.

It tells the agent how to move from open question to durable answer, including the expected artifact sections and the requirement to validate PARA taxonomy before finalization.

Skills are loaded on demand. They keep repeated procedures out of a bloated always-on system prompt.

### Memory

Agentic supports memory, but this public example does not ship with `.agentic/memory/*.json` records.

That is intentional. Memory is user-space: users may bring their own memories, storage adapters, and retention rules. A harness using this workspace can still call `memory recall` when user memory is configured, but the example itself keeps durable example output in artifacts.

Memories are not a transcript. They are compact facts the user wants the agent to remember across sessions.

### Task

`.agentic/tasks/*.json` stores open work.

The seeded task gives the agent a concrete research question and acts as the
onboarding breadcrumb. It points at the inbox and reading-queue artifacts, names
the persona/skill/workflow to use, and describes the durable state changes a real
run should leave behind. In a real second-brain workspace, tasks would be the
research questions, decisions, or follow-ups that should not disappear between
turns.

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

The seed artifacts include unfinalized inbox and reading-queue working state plus
one finalized `research-brief`. The finalized brief demonstrates the expected
output shape and the required PARA tag convention:

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
| `.agentic/personas/second-brain-steward.md` | Persona | Activates the stewardship hat: prune, promote, and choose next focus |
| `.agentic/skills/research-brief/skill.md` | Skill | Agent-facing procedure for turning a question into a cited brief |
| `.agentic/skills/steward-review/skill.md` | Skill | Agent-facing procedure for curating leftovers into clear next actions |
| `.agentic/skills/project-kickoff/skill.md` | Skill | Agent-facing procedure for interviewing before drafting a project plan |
| `.agentic/workflows/*.json` | Workflow | Research, project, review, archive, and inbox operating loops |
| `.agentic/tasks/*.json` | Tasks | A ready `START HERE` task that drives the dogfood path |
| `.agentic/artifacts/*` | Artifact | Inbox captures, a reading queue snapshot, and a finalized sample brief |

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

To dogfood this example, let the content drive the first run and watch for friction.

1. Run `agentic task next` and read the `START HERE` task.
2. Inspect the artifacts named by the task.
3. Activate the persona and skill named by the task.
4. Start or inspect a `research-loop` workflow run.
5. Do the research using whatever tools the harness provides.
6. Create or update a `research-brief` artifact.
7. Validate that the artifact has a `para:<bucket>/<slug>` tag.
8. Finalize the artifact.
9. Mark the task done and add the stewardship follow-up task the seed asks for.

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
