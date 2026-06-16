import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import type { RuntimeContext } from "@tnezdev/agentic/runtime"
import { runtime } from "./index.js"

const TASK_ID = "01KTC500000000000000000001"

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

  it("requires local runtime init before running", async () => {
    await writeSecondBrainWorkspace(tmpDir)

    await expect(runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: {},
    })).rejects.toThrow("Local runtime is not initialized")
  })

  it("prepares a workflow run and writes an inspectable artifact", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const result = await runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: {},
    })
    const data = dataOf(result)
    const artifactId = data["artifact_id"] as string
    const workflowRunId = data["workflow_run_id"] as string

    expect(result?.summary).toContain("Prepared local Agentic run")
    expect(data).toMatchObject({
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
    expect(meta.tags).toContain("workflow:research-loop")

    const body = await readFile(
      join(tmpDir, ".agentic", "artifacts", artifactId, "v1.md"),
      "utf-8",
    )
    expect(body).toContain(artifactId)
    expect(body).toContain(workflowRunId)
    expect(body).toContain("Research lightweight reading queue practices")
    expect(body).toContain(`--base-dir '${tmpDir}'`)

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
        artifact_id: artifactId,
      },
    })
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
