import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import type { RuntimeContext } from "@tnezdev/agentic/runtime"
import { runtime } from "./index.js"

const TASK_ID = "01KTC500000000000000000001"
const PROFILE_ARTIFACT_ID = "01KAC500000000000000000001"
const CONTINUITY_ARTIFACT_ID = "01KAC500000000000000000002"

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, "utf-8")
}

async function writeSecondBrainWorkspace(baseDir: string): Promise<void> {
  await writeText(
    join(baseDir, ".agentic", "personas", "researcher.md"),
    `---
name: researcher
description: Activate when turning an open question into a concise second-brain research brief
memory_tags: [second-brain, research]
skills: [research-brief]
task_filter:
  tags: [research]
  status: ready
workflow: research-loop
---

# Researcher

Use durable Agentic primitives.
You are working from {{cwd}} at {{timestamp}} on {{hostname}}.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "skills", "research-brief", "skill.md"),
    `---
name: research-brief
description: Activate when an agent needs to convert a research question into a cited second-brain brief
tags: [second-brain, research]
---

# Research Brief

Write a concise durable brief.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "workflows", "research-loop.json"),
    JSON.stringify(
      {
        id: "research-loop",
        name: "Second-brain research loop",
        version: "1.0",
        nodes: [
          { id: "frame-question", label: "Frame question" },
          { id: "write-brief", label: "Write brief" },
        ],
        edges: [{ from: "frame-question", to: "write-brief" }],
      },
      null,
      2,
    ),
  )
  await writeText(
    join(baseDir, ".agentic", "tasks", `${TASK_ID}.json`),
    JSON.stringify(
      {
        id: TASK_ID,
        description: "Research lightweight reading queue practices",
        status: "ready",
        tags: ["second-brain", "research"],
        annotations: [],
        created_at: "2026-06-05T16:00:00.000Z",
        updated_at: "2026-06-05T16:00:00.000Z",
      },
      null,
      2,
    ),
  )
}

async function writeArtifactAssistantWorkspace(baseDir: string): Promise<void> {
  await writeText(
    join(baseDir, ".agentic", "personas", "assistant.md"),
    `---
name: assistant
description: Activate when starting a personal assistant session from durable artifacts
memory_tags: [personal-assistant, continuity]
skills: [session-brief]
---

# Assistant

Load durable artifacts before acting.
You are working from {{cwd}} at {{timestamp}} on {{hostname}}.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "skills", "session-brief", "skill.md"),
    `---
name: session-brief
description: Activate when synthesizing a startup briefing from assistant artifacts
tags: [personal-assistant, continuity]
---

# Session Brief

Read mounted artifacts, brief the user, and wait for confirmation before doing follow-on work.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "artifacts", PROFILE_ARTIFACT_ID, "meta.json"),
    JSON.stringify(
      {
        id: PROFILE_ARTIFACT_ID,
        type: "user-profile",
        title: "Alex Profile",
        body_ref: `${PROFILE_ARTIFACT_ID}/v1.md`,
        version: 1,
        finalized: true,
        tags: ["personal-assistant", "session-start-context"],
        created_at: "2026-06-16T13:00:00.000Z",
        updated_at: "2026-06-16T13:00:00.000Z",
      },
      null,
      2,
    ),
  )
  await writeText(
    join(baseDir, ".agentic", "artifacts", PROFILE_ARTIFACT_ID, "v1.md"),
    "# Alex Profile\n\nAlex wants a conversational assistant that reconstructs context before acting.\n",
  )
  await writeText(
    join(baseDir, ".agentic", "artifacts", CONTINUITY_ARTIFACT_ID, "meta.json"),
    JSON.stringify(
      {
        id: CONTINUITY_ARTIFACT_ID,
        type: "continuity-brief",
        title: "Alex Continuity",
        body_ref: `${CONTINUITY_ARTIFACT_ID}/v1.md`,
        version: 1,
        finalized: true,
        tags: ["personal-assistant", "session-start-context"],
        created_at: "2026-06-16T13:00:00.000Z",
        updated_at: "2026-06-16T13:00:00.000Z",
      },
      null,
      2,
    ),
  )
  await writeText(
    join(baseDir, ".agentic", "artifacts", CONTINUITY_ARTIFACT_ID, "v1.md"),
    "# Alex Continuity\n\nOpen work: choose the next assistant portability experiment.\n",
  )
}

async function writeStewardPersonaAndWorkflow(baseDir: string): Promise<void> {
  await writeText(
    join(baseDir, ".agentic", "personas", "second-brain-steward.md"),
    `---
name: second-brain-steward
description: Activate when reviewing second-brain tasks and artifacts
memory_tags: [second-brain, stewardship]
skills: []
task_filter:
  tags: [stewardship]
  status: ready
workflow: weekly-review
---

# Steward

Review durable Agentic state.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "workflows", "weekly-review.json"),
    JSON.stringify(
      {
        id: "weekly-review",
        name: "Weekly review",
        version: "1.0",
        nodes: [{ id: "review", label: "Review" }],
        edges: [],
      },
      null,
      2,
    ),
  )
}

async function writeFakePi(binDir: string): Promise<string> {
  const path = join(binDir, "pi")
  await writeText(
    path,
    `#!/bin/sh
printf '%s\n' "$@" > "$PI_ARGS_FILE"
printf '%s\n' "$PWD" > "$PI_CWD_FILE"
if [ -n "$PI_STDOUT_FILE" ]; then
  printf 'fake pi completed\n' > "$PI_STDOUT_FILE"
else
  printf 'fake pi completed\n'
fi
`,
  )
  await chmod(path, 0o755)
  return path
}

function dataOf(
  result: Awaited<ReturnType<NonNullable<typeof runtime.commands.run>>>,
): Record<string, unknown> {
  return result?.data as Record<string, unknown>
}

describe("local runtime package", () => {
  let tmpDir: string
  let ctx: RuntimeContext

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentic-runtime-local-test-"))
    ctx = {
      cwd: tmpDir,
      workspace_root: tmpDir,
      runtime_name: "local",
      runtime_package: "@tnezdev/agentic-runtime-local",
      json: true,
      env: {},
      config: {
        adapter: "filesystem",
        memory: {
          dir: ".agentic/memory",
          defaultTier: "L1",
          dreamDepth: 3,
        },
        workflow: {
          graphsDir: ".agentic/workflows",
          runsDir: ".agentic/runs",
        },
        wake: {},
        runtime: {
          targets: {},
        },
      },
      runtime_config: {},
      agentic: {} as RuntimeContext["agentic"],
    }
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("exports a valid local runtime manifest", () => {
    expect(runtime.kind).toBe("agentic-runtime")
    expect(runtime.api_version).toBe(1)
    expect(runtime.name).toBe("local")
    expect(runtime.package_name).toBe("@tnezdev/agentic-runtime-local")
    expect(runtime.capabilities).toEqual(["init", "run", "status"])
    expect(runtime.commands.init).toBeFunction()
    expect(runtime.commands.run).toBeFunction()
    expect(runtime.commands.status).toBeFunction()
  })

  it("initializes local runtime glue idempotently", async () => {
    const first = await runtime.commands.init!(ctx, { args: [], flags: {} })
    const second = await runtime.commands.init!(ctx, { args: [], flags: {} })

    expect(first?.summary).toContain("Initialized")
    expect(second?.summary).toContain("already initialized")

    const state = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "runtime", "local", "runtime.json"), "utf-8"),
    )
    expect(state).toEqual({
      version: 1,
      runtime: "local",
      package_name: "@tnezdev/agentic-runtime-local",
      targets_dir: "targets",
      invocations_dir: "invocations",
    })
  })

  it("reports status before and after init", async () => {
    const before = await runtime.commands.status!(ctx, { args: [], flags: {} })
    expect(before?.data).toMatchObject({ initialized: false })

    await runtime.commands.init!(ctx, { args: [], flags: {} })
    const after = await runtime.commands.status!(ctx, { args: [], flags: {} })

    expect(after?.summary).toContain("initialized")
    expect(after?.data).toMatchObject({
      initialized: true,
      targets_dir_exists: true,
    })
  })

  it("auto-initializes local runtime glue before running", async () => {
    await writeSecondBrainWorkspace(tmpDir)

    const result = await runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: {},
    })

    expect(result?.summary).toContain("Prepared local Agentic run")
    const state = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "runtime", "local", "runtime.json"), "utf-8"),
    )
    expect(state.runtime).toBe("local")
  })

  it("uses ready task metadata for no-arg run selection", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await writeStewardPersonaAndWorkflow(tmpDir)

    const taskPath = join(tmpDir, ".agentic", "tasks", `${TASK_ID}.json`)
    const task = JSON.parse(await readFile(taskPath, "utf-8")) as Record<string, unknown>
    task.metadata = { persona: "researcher", workflow: "research-loop" }
    await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, "utf-8")

    const result = await runtime.commands.run!(ctx, {
      args: [],
      flags: {},
    })
    const data = dataOf(result)

    expect(data).toMatchObject({
      workflow_id: "research-loop",
      persona: "researcher",
      task: {
        id: TASK_ID,
      },
    })
  })

  it("fails clearly when no-arg run is ambiguous", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await writeStewardPersonaAndWorkflow(tmpDir)

    await expect(runtime.commands.run!(ctx, {
      args: [],
      flags: {},
    })).rejects.toThrow("multiple personas are available")
  })

  it("prepares a workflow run and writes an inspectable artifact", async () => {
    await writeSecondBrainWorkspace(tmpDir)

    const result = await runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: {},
    })
    const data = dataOf(result)
    const artifactId = data["artifact_id"] as string
    const workflowRunId = data["workflow_run_id"] as string
    const invocationId = data["invocation_id"] as string

    expect(result?.summary).toContain("Prepared local Agentic run")
    expect(data).toMatchObject({
      invocation_id: invocationId,
      invocation_path: `.agentic/runtime/local/invocations/${invocationId}.json`,
      target: "research-loop",
      initialized: true,
      workflow_id: "research-loop",
      persona: "researcher",
      skills: ["research-brief"],
      task: {
        id: TASK_ID,
        description: "Research lightweight reading queue practices",
      },
    })

    const meta = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "artifacts", artifactId, "meta.json"), "utf-8"),
    )
    expect(meta.type).toBe("local-runtime-run")
    expect(meta.finalized).toBe(true)
    expect(meta.tags).toContain(`invocation:${invocationId}`)
    expect(meta.tags).toContain("workflow:research-loop")

    const body = await readFile(
      join(tmpDir, ".agentic", "artifacts", artifactId, "v1.md"),
      "utf-8",
    )
    expect(body).toContain(artifactId)
    expect(body).toContain(workflowRunId)
    expect(body).toContain(invocationId)
    expect(body).toContain(`.agentic/runtime/local/invocations/${invocationId}.json`)
    expect(body).toContain("Research lightweight reading queue practices")
    expect(body).toContain(`--base-dir '${tmpDir}'`)

    const invocation = JSON.parse(
      await readFile(
        join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.json`),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      id: invocationId,
      runtime: "local",
      runtime_package: "@tnezdev/agentic-runtime-local",
      target: "research-loop",
      workspace_root: tmpDir,
      status: "completed",
      workflow_run_id: workflowRunId,
      artifact_ids: [artifactId],
    })
    expect(invocation.harness_ref).toBeUndefined()
    expect(typeof invocation.started_at).toBe("string")
    expect(typeof invocation.ended_at).toBe("string")

    const workflowRun = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "runs", `${workflowRunId}.json`), "utf-8"),
    )
    expect(workflowRun.graph_id).toBe("research-loop")
    expect(workflowRun.history[0]).toMatchObject({
      node_id: "frame-question",
      from_status: "pending",
      to_status: "in_progress",
      identity: "local-runtime",
      metadata: {
        invocation_id: invocationId,
        artifact_id: artifactId,
      },
    })

    const status = await runtime.commands.status!(ctx, { args: [], flags: {} })
    expect(status?.data).toMatchObject({
      invocation_count: 1,
      last_invocation: {
        id: invocationId,
        status: "completed",
        workflow_run_id: workflowRunId,
        artifact_ids: [artifactId],
        harness_ref: undefined,
      },
    })
  })

  it("can prepare persona, skills, and artifacts without task or workflow state", async () => {
    await writeArtifactAssistantWorkspace(tmpDir)

    const result = await runtime.commands.run!(ctx, {
      args: [],
      flags: {
        context: "artifacts",
        persona: "assistant",
        "artifact-tags": "session-start-context",
      },
    })
    const data = dataOf(result)
    const artifactId = data["artifact_id"] as string
    const invocationId = data["invocation_id"] as string

    expect(result?.summary).toContain("Prepared local Agentic run")
    expect(data).toMatchObject({
      context_mode: "artifacts",
      workflow_id: null,
      workflow_run_id: null,
      persona: "assistant",
      skills: ["session-brief"],
      task: null,
      input_artifacts: [
        { id: PROFILE_ARTIFACT_ID, type: "user-profile", title: "Alex Profile", version: 1 },
        { id: CONTINUITY_ARTIFACT_ID, type: "continuity-brief", title: "Alex Continuity", version: 1 },
      ],
    })

    const meta = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "artifacts", artifactId, "meta.json"), "utf-8"),
    )
    expect(meta.type).toBe("local-runtime-run")
    expect(meta.tags).toContain("context:artifacts")
    expect(meta.tags).not.toContain("workflow:research-loop")

    const body = await readFile(
      join(tmpDir, ".agentic", "artifacts", artifactId, "v1.md"),
      "utf-8",
    )
    expect(body).toContain("Context mode: artifacts")
    expect(body).toContain("Workflow run id: none created")
    expect(body).toContain(PROFILE_ARTIFACT_ID)
    expect(body).toContain(CONTINUITY_ARTIFACT_ID)
    expect(body).not.toContain("agentic workflow status")

    const invocation = JSON.parse(
      await readFile(
        join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.json`),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      id: invocationId,
      status: "completed",
      artifact_ids: [artifactId],
    })
    expect(invocation.workflow_run_id).toBeUndefined()
  })

  it("can invoke Pi as an optional local harness", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const binDir = join(tmpDir, "bin")
    const piArgsFile = join(tmpDir, "pi-args.txt")
    const piCwdFile = join(tmpDir, "pi-cwd.txt")
    await writeFakePi(binDir)

    const result = await runtime.commands.run!({
      ...ctx,
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PI_ARGS_FILE: piArgsFile,
        PI_CWD_FILE: piCwdFile,
      },
    }, {
      target: "research-loop",
      args: [],
      flags: { harness: "pi" },
    })
    const data = dataOf(result)
    const invocationId = data["invocation_id"] as string
    const artifactId = data["artifact_id"] as string
    const workflowRunId = data["workflow_run_id"] as string

    expect(result?.summary).toContain("through Pi session")
    expect(data["harness"]).toEqual({ provider: "pi", id: invocationId })
    expect(data["harness_result"]).toMatchObject({
      provider: "pi",
      mode: "print",
      session_id: invocationId,
      session_dir: ".agentic/runtime/local/pi-sessions",
      system_prompt_path: `.agentic/runtime/local/invocations/${invocationId}.pi-system.md`,
      user_prompt_path: `.agentic/runtime/local/invocations/${invocationId}.pi-user.md`,
      exit_code: 0,
      stdout: "fake pi completed\n",
    })

    const piArgs = (await readFile(piArgsFile, "utf-8")).split("\n")
    expect(piArgs).toContain("--print")
    expect(piArgs).toContain("--mode")
    expect(piArgs).toContain("text")
    expect(piArgs).toContain("--session-id")
    expect(piArgs).toContain(invocationId)
    expect(piArgs).toContain("--session-dir")
    expect(piArgs).toContain(join(tmpDir, ".agentic", "runtime", "local", "pi-sessions"))
    expect(piArgs).toContain("--append-system-prompt")
    expect(piArgs).toContain(join(
      tmpDir,
      ".agentic",
      "runtime",
      "local",
      "invocations",
      `${invocationId}.pi-system.md`,
    ))
    expect(piArgs).toContain(`@${join(
      tmpDir,
      ".agentic",
      "runtime",
      "local",
      "invocations",
      `${invocationId}.pi-user.md`,
    )}`)
    expect((await readFile(piCwdFile, "utf-8")).trim().endsWith(tmpDir)).toBe(true)

    const systemPrompt = await readFile(
      join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.pi-system.md`),
      "utf-8",
    )
    expect(systemPrompt).toContain("You are Pi running behind the Agentic local runtime")
    expect(systemPrompt).toContain("researcher")
    expect(systemPrompt).toContain("research-brief")
    expect(systemPrompt).toContain(workflowRunId)
    expect(systemPrompt).toContain(artifactId)
    expect(systemPrompt).toContain(`working from ${tmpDir}`)
    expect(systemPrompt).not.toContain("{{cwd}}")
    expect(systemPrompt).not.toContain("{{timestamp}}")
    expect(systemPrompt).not.toContain("{{hostname}}")

    const userPrompt = await readFile(
      join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.pi-user.md`),
      "utf-8",
    )
    expect(userPrompt).toContain("Research lightweight reading queue practices")

    const invocation = JSON.parse(
      await readFile(
        join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.json`),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      id: invocationId,
      status: "completed",
      workflow_run_id: workflowRunId,
      artifact_ids: [artifactId],
      harness_ref: {
        provider: "pi",
        id: invocationId,
      },
    })

    const body = await readFile(
      join(tmpDir, ".agentic", "artifacts", artifactId, "v1.md"),
      "utf-8",
    )
    expect(body).toContain("Provider: pi")
    expect(body).toContain(`Session id: ${invocationId}`)
  })

  it("can attach Pi as an interactive local harness", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const binDir = join(tmpDir, "bin")
    const piArgsFile = join(tmpDir, "pi-args.txt")
    const piCwdFile = join(tmpDir, "pi-cwd.txt")
    const piStdoutFile = join(tmpDir, "pi-stdout.txt")
    await writeFakePi(binDir)

    const result = await runtime.commands.run!({
      ...ctx,
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PI_ARGS_FILE: piArgsFile,
        PI_CWD_FILE: piCwdFile,
        PI_STDOUT_FILE: piStdoutFile,
      },
    }, {
      target: "research-loop",
      args: [],
      flags: { harness: "pi", interactive: true },
    })
    const data = dataOf(result)
    const invocationId = data["invocation_id"] as string

    expect(result?.summary).toContain("through Pi session")
    expect(data["harness_result"]).toMatchObject({
      provider: "pi",
      mode: "interactive",
      session_id: invocationId,
      session_dir: ".agentic/runtime/local/pi-sessions",
      system_prompt_path: `.agentic/runtime/local/invocations/${invocationId}.pi-system.md`,
      user_prompt_path: `.agentic/runtime/local/invocations/${invocationId}.pi-user.md`,
      exit_code: 0,
      stdout: "",
      stderr: "",
    })

    const piArgs = (await readFile(piArgsFile, "utf-8")).split("\n")
    expect(piArgs).not.toContain("--print")
    expect(piArgs).not.toContain("--mode")
    expect(piArgs).not.toContain("text")
    expect(piArgs).toContain("--session-id")
    expect(piArgs).toContain(invocationId)
    expect(piArgs).toContain("--session-dir")
    expect(piArgs).toContain(join(tmpDir, ".agentic", "runtime", "local", "pi-sessions"))
    expect(piArgs).toContain("--append-system-prompt")
    expect(piArgs).toContain(join(
      tmpDir,
      ".agentic",
      "runtime",
      "local",
      "invocations",
      `${invocationId}.pi-system.md`,
    ))
    expect(piArgs).toContain(`@${join(
      tmpDir,
      ".agentic",
      "runtime",
      "local",
      "invocations",
      `${invocationId}.pi-user.md`,
    )}`)
    expect((await readFile(piCwdFile, "utf-8")).trim().endsWith(tmpDir)).toBe(true)
    expect(await readFile(piStdoutFile, "utf-8")).toBe("fake pi completed\n")
  })

  it("prompts interactive Pi to brief and wait in artifact context mode", async () => {
    await writeArtifactAssistantWorkspace(tmpDir)
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const binDir = join(tmpDir, "bin")
    const piArgsFile = join(tmpDir, "pi-args.txt")
    const piCwdFile = join(tmpDir, "pi-cwd.txt")
    const piStdoutFile = join(tmpDir, "pi-stdout.txt")
    await writeFakePi(binDir)

    const result = await runtime.commands.run!({
      ...ctx,
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PI_ARGS_FILE: piArgsFile,
        PI_CWD_FILE: piCwdFile,
        PI_STDOUT_FILE: piStdoutFile,
      },
    }, {
      args: [],
      flags: {
        context: "artifacts",
        persona: "assistant",
        "artifact-tags": "session-start-context",
        harness: "pi",
        interactive: true,
      },
    })
    const data = dataOf(result)
    const invocationId = data["invocation_id"] as string

    expect(data).toMatchObject({
      context_mode: "artifacts",
      workflow_id: null,
      workflow_run_id: null,
    })
    expect(data["harness_result"]).toMatchObject({
      provider: "pi",
      mode: "interactive",
      session_id: invocationId,
    })

    const piArgs = (await readFile(piArgsFile, "utf-8")).split("\n")
    expect(piArgs).not.toContain("--print")
    expect(piArgs).toContain("Agentic assistant")

    const systemPrompt = await readFile(
      join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.pi-system.md`),
      "utf-8",
    )
    expect(systemPrompt).toContain("Context mode: artifacts")
    expect(systemPrompt).toContain("No workflow is selected")
    expect(systemPrompt).toContain("No task projection was mounted")
    expect(systemPrompt).toContain("Alex wants a conversational assistant")
    expect(systemPrompt).toContain("choose the next assistant portability experiment")
    expect(systemPrompt).not.toContain("No ready task matched")
    expect(systemPrompt).not.toContain("{{cwd}}")

    const userPrompt = await readFile(
      join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.pi-user.md`),
      "utf-8",
    )
    expect(userPrompt).toContain("Start a personal-assistant session from the mounted Agentic artifacts")
    expect(userPrompt).toContain("stop and wait for the user")
    expect(userPrompt).not.toContain("Work the selected task")
    expect(userPrompt).not.toContain("workflow run")
  })

  it("requires the Pi harness for interactive mode", async () => {
    await writeSecondBrainWorkspace(tmpDir)

    await expect(runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: { interactive: true },
    })).rejects.toThrow("requires `--harness pi`")
  })

  it("records failed invocations after a run starts", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await runtime.commands.init!(ctx, { args: [], flags: {} })
    await rm(join(tmpDir, ".agentic", "skills", "research-brief"), {
      recursive: true,
      force: true,
    })

    await expect(runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: {},
    })).rejects.toThrow('Skill "research-brief"')

    const files = await readdir(join(tmpDir, ".agentic", "runtime", "local", "invocations"))
    expect(files).toHaveLength(1)

    const invocation = JSON.parse(
      await readFile(
        join(tmpDir, ".agentic", "runtime", "local", "invocations", files[0]!),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      runtime: "local",
      runtime_package: "@tnezdev/agentic-runtime-local",
      target: "research-loop",
      workspace_root: tmpDir,
      status: "failed",
      artifact_ids: [],
    })
    expect(invocation.error).toContain('Skill "research-brief"')
    expect(typeof invocation.started_at).toBe("string")
    expect(typeof invocation.ended_at).toBe("string")
  })

  it("can run a nested Agentic workspace target", async () => {
    const workspace = join(tmpDir, "examples", "second-brain")
    await writeSecondBrainWorkspace(workspace)
    await runtime.commands.init!({ ...ctx, cwd: workspace, workspace_root: workspace }, {
      args: [],
      flags: {},
    })

    const result = await runtime.commands.run!(ctx, {
      target: "examples/second-brain",
      args: [],
      flags: {},
    })
    const data = dataOf(result)

    expect(data).toMatchObject({
      target: "examples/second-brain",
      workspace: "examples/second-brain",
      workflow_id: "research-loop",
      persona: "researcher",
    })
  })
})
