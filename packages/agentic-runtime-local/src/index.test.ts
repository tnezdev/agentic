import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RuntimeContext } from "@tnezdev/agentic/runtime"
import { runtime } from "./index.js"
import type { GraphDef, Run, Transition, WorkflowAdapter } from "@tnezdev/agentic"

/** Minimal workflow adapter for testing run without filesystem. */
class InMemoryWorkflowAdapter implements WorkflowAdapter {
  private graphs: Map<string, GraphDef> = new Map()
  private runs: Map<string, Run> = new Map()
  private runCounter = 0

  async saveGraph(graph: GraphDef): Promise<void> { this.graphs.set(graph.id, graph) }
  async loadGraph(graphId: string, _version?: string): Promise<GraphDef | undefined> { return this.graphs.get(graphId) }
  async listGraphs(): Promise<GraphDef[]> { return [...this.graphs.values()] }
  async saveSourceGraph?(graph: GraphDef): Promise<void> { this.graphs.set(graph.id, graph) }
  async loadSourceGraph?(graphId: string): Promise<GraphDef | undefined> { return this.graphs.get(graphId) }

  async createRun(graphId: string, name?: string, graphVersion?: string): Promise<Run> {
    this.runCounter++
    const run: Run = {
      run_id: `run-${this.runCounter}`,
      graph_id: graphId,
      ...((graphVersion !== undefined) && { graph_version: graphVersion }),
      ...((name !== undefined) && { name }),
      history: [],
      created_at: new Date().toISOString(),
    }
    this.runs.set(run.run_id, run)
    return run
  }
  async loadRun(runId: string): Promise<Run | undefined> { return this.runs.get(runId) }
  async listRuns(_graphId?: string): Promise<Run[]> { return [...this.runs.values()] }
  async appendTransition(runId: string, transition: Transition): Promise<void> {
    const run = this.runs.get(runId)
    if (run) run.history.push(transition)
  }
}

const sampleGraph: GraphDef = {
  id: "project-kickoff",
  name: "Project kickoff",
  description: "Turn a project idea into a scoped PARA project",
  version: "1",
  nodes: [
    { id: "intake", label: "Ask kickoff questions", artifact: { type: "project-intake", required: true } },
    { id: "plan", label: "Create project plan", artifact: { type: "project-plan", required: true } },
  ],
  edges: [
    { from: "intake", to: "plan" },
  ],
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
        memory: { dir: ".agentic/memory", defaultTier: "L1", dreamDepth: 3 },
        workflow: { graphsDir: ".agentic/workflows", runsDir: ".agentic/runs" },
        wake: {},
        runtime: { targets: {} },
      },
      runtime_config: {},
      agentic: {} as RuntimeContext["agentic"],
    }
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
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

  it("requires initialization before run", async () => {
    const result = await runtime.commands.run!(ctx, {
      target: "project-kickoff",
      args: [],
      flags: {},
    })

    expect(result?.summary).toContain("not initialized")
    expect(result?.data).toMatchObject({ target: "project-kickoff", initialized: false })
  })

  it("lists available workflows when no target specified", async () => {
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    // Set up workflow adapter with a sample graph
    const adapter = new InMemoryWorkflowAdapter()
    await adapter.saveGraph(sampleGraph)
    ctx.agentic = { ...ctx.agentic, workflows: adapter }

    const result = await runtime.commands.run!(ctx, { target: undefined, args: [], flags: {} })

    expect(result?.summary).toContain("Specify a target workflow")
    expect(result?.summary).toContain("project-kickoff")
    expect(result?.data).toMatchObject({
      initialized: true,
      available_graphs: [{ id: "project-kickoff", name: "Project kickoff" }],
    })
  })

  it("reports empty workflows when none exist", async () => {
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const adapter = new InMemoryWorkflowAdapter()
    ctx.agentic = { ...ctx.agentic, workflows: adapter }

    const result = await runtime.commands.run!(ctx, { target: undefined, args: [], flags: {} })

    expect(result?.summary).toContain("No workflows found")
  })

  it("creates a run when target resolves to a workflow", async () => {
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const adapter = new InMemoryWorkflowAdapter()
    await adapter.saveGraph(sampleGraph)
    ctx.agentic = { ...ctx.agentic, workflows: adapter }

    const result = await runtime.commands.run!(ctx, {
      target: "project-kickoff",
      args: [],
      flags: {},
    })

    expect(result?.summary).toContain("Created run")
    expect(result?.summary).toContain("Project kickoff")
    expect(result?.summary).toContain("run-1")
    expect(result?.data).toMatchObject({
      target: "project-kickoff",
      initialized: true,
      graph_id: "project-kickoff",
      graph_name: "Project kickoff",
    })
    const data = result?.data as Record<string, unknown>
    expect(data.run_id).toBeString()
    expect(data.available_nodes).toBeArray()
  })

  it("reports not found for unknown target", async () => {
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const adapter = new InMemoryWorkflowAdapter()
    await adapter.saveGraph(sampleGraph)
    ctx.agentic = { ...ctx.agentic, workflows: adapter }

    const result = await runtime.commands.run!(ctx, {
      target: "nonexistent-workflow",
      args: [],
      flags: {},
    })

    expect(result?.summary).toContain("not found")
    expect(result?.data).toMatchObject({
      target: "nonexistent-workflow",
      error: "graph_not_found",
    })
  })
})
