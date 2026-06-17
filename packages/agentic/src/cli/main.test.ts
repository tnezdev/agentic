import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { delimiter, join } from "node:path"
import { tmpdir } from "node:os"

const CLI = join(import.meta.dir, "main.ts")
const REPO_ROOT = join(import.meta.dir, "../../../..")
const AGENTIC_NEXT = join(REPO_ROOT, "examples", "agentic-next")

async function run(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runWithEnv({}, ...args)
}

async function runWithEnv(
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: { ...process.env, AGENTIC_RUNTIME_PACKAGE_DIRS: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

async function runJson(...args: string[]): Promise<unknown> {
  const { stdout } = await run("--json", ...args)
  return JSON.parse(stdout)
}

async function runJsonWithEnv(
  env: Record<string, string>,
  ...args: string[]
): Promise<unknown> {
  const { stdout } = await runWithEnv(env, "--json", ...args)
  return JSON.parse(stdout)
}

async function writeRuntimePackage(baseDir: string, source?: string): Promise<void> {
  const pkgDir = join(
    baseDir,
    "node_modules",
    "@tnezdev",
    "agentic-runtime-local",
  )
  await mkdir(pkgDir, { recursive: true })
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.js" }, null, 2),
  )
  await writeFile(
    join(pkgDir, "index.js"),
    source ?? `export const runtime = {
  kind: "agentic-runtime",
  api_version: 1,
  name: "local",
  package_name: "@tnezdev/agentic-runtime-local",
  description: "Test local runtime",
  capabilities: ["init", "run", "status"],
  commands: {
    init: async (ctx, args) => ({
      summary: "initialized local runtime",
      data: { runtime_config: ctx.runtime_config, args: args.args },
    }),
    run: async (ctx, args) => ({
      summary: "ran local target",
      data: { target: args.target, args: args.args, flags: args.flags, json: ctx.json },
    }),
    status: async () => ({
      summary: "runtime ready",
      data: { ready: true },
    }),
  },
}
`,
  )
}

async function writeRuntimeWorkspacePackage(packagesDir: string): Promise<void> {
  const pkgDir = join(packagesDir, "agentic-runtime-local")
  await mkdir(join(pkgDir, "src"), { recursive: true })
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: "@tnezdev/agentic-runtime-local",
        type: "module",
        exports: "./dist/index.js",
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(pkgDir, "src", "index.ts"),
    `export const runtime = {
  kind: "agentic-runtime",
  api_version: 1,
  name: "local",
  package_name: "@tnezdev/agentic-runtime-local",
  description: "Workspace local runtime",
  capabilities: ["init", "run", "status"],
  commands: {
    init: async (ctx, args) => ({
      summary: "initialized workspace runtime",
      data: { cwd: ctx.cwd, args: args.args },
    }),
    run: async (ctx, args) => ({
      summary: "ran workspace target",
      data: { target: args.target, args: args.args },
    }),
    status: async () => ({
      summary: "workspace runtime ready",
      data: { ready: true },
    }),
  },
}
`,
  )
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

async function writeMinimalInspectBundle(workspace: string): Promise<string> {
  const bundleRoot = join(workspace, ".agentic")
  await mkdir(bundleRoot, { recursive: true })
  await writeJson(join(bundleRoot, "agentic.json"), {
    schema_version: "agentic-next.example.v0",
    name: "inspect-demo",
    version: "0.1.0",
    description: "Inspect demo bundle.",
    state: { adapter: "filesystem", dir: ".agentic/.data" },
    principals: [{ id: "service:test" }],
    prompts: [],
    skills: [],
    artifacts: [],
    actions: [],
    capabilities: [],
    hooks: [],
    surfaces: [],
    schedules: [],
    integrations: [],
    policies: [],
    deploy: [],
    evals: [],
    fixtures: [],
  })
  return bundleRoot
}

async function writeMinimalEvalBundle(
  workspace: string,
  evals: Array<{ id: string; data: Record<string, unknown> }> = [defaultEvalDeclaration()],
): Promise<string> {
  const bundleRoot = join(workspace, ".agentic")
  await mkdir(join(bundleRoot, "evals"), { recursive: true })
  await mkdir(join(bundleRoot, "fixtures"), { recursive: true })
  await writeJson(join(bundleRoot, "agentic.json"), {
    schema_version: "agentic-next.example.v0",
    name: "eval-demo",
    version: "0.1.0",
    description: "Eval demo bundle.",
    state: { adapter: "filesystem", dir: ".agentic/.data" },
    principals: [{ id: "service:test" }],
    prompts: [],
    skills: [],
    artifacts: [],
    actions: [],
    capabilities: [],
    hooks: [],
    surfaces: [],
    schedules: [],
    integrations: [],
    policies: [],
    deploy: [],
    evals: evals.map((entry) => ({ id: entry.id, path: `evals/${entry.id}.json` })),
    fixtures: [{ id: "fixture-001", path: "fixtures/fixture-001.json" }],
  })
  for (const entry of evals) {
    await writeJson(join(bundleRoot, "evals", `${entry.id}.json`), entry.data)
  }
  await writeJson(join(bundleRoot, "fixtures", "fixture-001.json"), { id: "fixture-001" })
  return bundleRoot
}

function defaultEvalDeclaration(overrides: Record<string, unknown> = {}): { id: string; data: Record<string, unknown> } {
  return {
    id: "smoke",
    data: {
      id: "smoke",
      kind: "eval_declaration",
      fixture: "fixture-001",
      expect: {
        artifacts: ["case-packet", "approval-request"],
        actions: ["surface.receive", "external.handoff"],
        approval_required: "external.handoff",
        external_write_executed: false,
      },
      ...overrides,
    },
  }
}

async function writeInspectRuntimeState(workspace: string): Promise<void> {
  const runDir = join(workspace, ".agentic", ".data", "runs", "run-001")
  await mkdir(join(runDir, "actions"), { recursive: true })
  await mkdir(join(runDir, "artifacts"), { recursive: true })
  await writeJson(join(workspace, ".agentic", ".data", "latest.json"), { run_id: "run-001" })
  await writeFile(join(runDir, "actions.jsonl"), "", "utf-8")
  await writeFile(join(runDir, "summary.md"), "# Summary\n", "utf-8")
  await writeJson(join(runDir, "actions", "a1.json"), { id: "a1", status: "completed" })
  await writeJson(join(runDir, "actions", "a2.json"), { id: "a2", status: "approval_required" })
  await writeJson(join(runDir, "artifacts", "art1.json"), { id: "art1", type: "case-packet" })
  await writeJson(join(runDir, "artifacts", "approval1.json"), { id: "approval1", type: "approval-request" })
}

async function writeEvalRuntimeState(
  workspace: string,
  runId = "run-001",
  options: { latestRunId?: string | undefined; includeApprovalArtifact?: boolean | undefined } = {},
): Promise<void> {
  const runDir = join(workspace, ".agentic", ".data", "runs", runId)
  await mkdir(join(runDir, "actions"), { recursive: true })
  await mkdir(join(runDir, "artifacts"), { recursive: true })
  await writeJson(join(workspace, ".agentic", ".data", "latest.json"), { run_id: options.latestRunId ?? runId })
  await writeJson(join(runDir, "actions", "a1.json"), {
    id: "a1",
    type: "surface.receive",
    status: "completed",
  })
  await writeJson(join(runDir, "actions", "a2.json"), {
    id: "a2",
    type: "external.handoff",
    status: "approval_required",
  })
  await writeJson(join(runDir, "artifacts", "art1.json"), { id: "art1", type: "case-packet" })
  if (options.includeApprovalArtifact !== false) {
    await writeJson(join(runDir, "artifacts", "approval1.json"), { id: "approval1", type: "approval-request" })
  }
}

async function writeUnknownTriggerBundle(workspace: string): Promise<void> {
  const bundleRoot = join(workspace, ".agentic")
  await mkdir(join(bundleRoot, "schedules"), { recursive: true })
  await writeJson(join(bundleRoot, "agentic.json"), {
    schema_version: "agentic-next.example.v0",
    name: "bad-demo",
    version: "0.1.0",
    description: "Bad demo bundle.",
    state: { adapter: "filesystem", dir: ".agentic/.data" },
    principals: [{ id: "service:test" }],
    prompts: [],
    skills: [],
    artifacts: [],
    actions: [],
    capabilities: [],
    hooks: [],
    surfaces: [],
    schedules: [{ id: "bad-schedule", path: "schedules/bad.json" }],
    integrations: [],
    policies: [],
    deploy: [],
    evals: [],
    fixtures: [],
  })
  await writeJson(join(bundleRoot, "schedules", "bad.json"), {
    id: "bad-schedule",
    cron: "0 3 * * *",
    principal: "service:test",
    proposes: {
      action: "missing.action",
    },
  })
}

describe("CLI", () => {
  let tmpDir: string
  let base: string[]

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-cli-test-"))
    base = ["--base-dir", tmpDir]
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it("shows usage with no args", async () => {
    const { stdout, exitCode } = await run()
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Usage: agentic")
  })

  it("shows usage with --help", async () => {
    const { stdout, exitCode } = await run("--help")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Usage: agentic")
    expect(stdout).toContain("eval [path]")
    expect(stdout).toContain("inspect [path]")
    expect(stdout).toContain("validate [path]")
    expect(stdout).toContain("runtime list")
  })

  describe("validate", () => {
    it("validates the agentic-next workspace path", async () => {
      const result = (await runJson("validate", AGENTIC_NEXT)) as {
        valid: boolean
        root: string
        bundle: { name: string; version: string; schema_version: string } | null
        checks: Array<Record<string, unknown>>
        errors: unknown[]
      }

      expect(result.valid).toBe(true)
      expect(result.root).toBe(join(AGENTIC_NEXT, ".agentic"))
      expect(result.bundle?.name).toBe("regulated-case-review")
      expect(result.bundle?.version).toBe("0.1.0-experimental")
      expect(result.bundle?.schema_version).toBe("agentic-next.example.v0")
      expect(result.errors).toEqual([])
      expect(result.checks.map((check) => check.name)).toEqual([
        "manifest",
        "bundle_refs",
        "artifacts",
        "action_gateway",
        "triggers",
        "evals",
      ])
    })

    it("validates a direct bundle root", async () => {
      const bundleRoot = join(AGENTIC_NEXT, ".agentic")
      const result = (await runJson("validate", bundleRoot)) as {
        valid: boolean
        root: string
        manifest_path: string | null
      }

      expect(result.valid).toBe(true)
      expect(result.root).toBe(bundleRoot)
      expect(result.manifest_path).toBe(join(bundleRoot, "agentic.yaml"))
    })

    it("validates the base-dir workspace with no positional path", async () => {
      const result = (await runJson(
        "--base-dir",
        AGENTIC_NEXT,
        "validate",
      )) as { valid: boolean; root: string }

      expect(result.valid).toBe(true)
      expect(result.root).toBe(join(AGENTIC_NEXT, ".agentic"))
    })

    it("exits 1 with a JSON envelope when the manifest is missing", async () => {
      await mkdir(join(tmpDir, ".agentic"), { recursive: true })

      const { stdout, exitCode } = await run("--json", ...base, "validate")
      expect(exitCode).toBe(1)
      const result = JSON.parse(stdout) as {
        valid: boolean
        root: string
        manifest_path: string | null
        bundle: null
        checks: Array<{ name: string; status: string }>
        errors: Array<{ field: string; message: string }>
      }

      expect(result.valid).toBe(false)
      expect(result.root).toBe(join(tmpDir, ".agentic"))
      expect(result.manifest_path).toBeNull()
      expect(result.bundle).toBeNull()
      expect(result.checks).toEqual([{ name: "manifest", status: "failed" }])
      expect(result.errors[0]?.field).toBe("bundle")
      expect(result.errors[0]?.message).toContain("Missing bundle manifest")
    })

    it("exits 1 and reports unknown trigger actions", async () => {
      await writeUnknownTriggerBundle(tmpDir)

      const { stdout, exitCode } = await run("--json", ...base, "validate")
      expect(exitCode).toBe(1)
      const result = JSON.parse(stdout) as {
        valid: boolean
        checks: Array<{ name: string; status: string }>
        errors: Array<{ field: string; message: string }>
      }
      const triggerCheck = result.checks.find((check) => check.name === "triggers")

      expect(result.valid).toBe(false)
      expect(triggerCheck?.status).toBe("failed")
      expect(result.errors.some((error) => error.field === "schedules[0].proposes.action")).toBe(true)
      expect(result.errors.some((error) => error.message === "unknown action: missing.action")).toBe(true)
    })

    it("exits 1 and reports malformed eval declarations", async () => {
      await writeMinimalEvalBundle(tmpDir, [
        defaultEvalDeclaration({
          expect: {
            artifacts: "case-packet",
            external_write_executed: false,
          },
        }),
      ])

      const { stdout, exitCode } = await run("--json", ...base, "validate")
      expect(exitCode).toBe(1)
      const result = JSON.parse(stdout) as {
        valid: boolean
        checks: Array<{ name: string; status: string; count?: number }>
        errors: Array<{ field: string; message: string }>
      }
      const evalsCheck = result.checks.find((check) => check.name === "evals")

      expect(result.valid).toBe(false)
      expect(evalsCheck).toEqual({ name: "evals", status: "failed", count: 1 })
      expect(result.errors.some((error) => error.field === "evals.smoke.expect.artifacts")).toBe(true)
      expect(result.errors.some((error) => error.field === "evals.smoke.expect.external_write_executed")).toBe(true)
    })

    it("exits 1 and reports eval fixture refs missing from the manifest", async () => {
      await writeMinimalEvalBundle(tmpDir, [defaultEvalDeclaration({ fixture: "missing-fixture" })])

      const { stdout, exitCode } = await run("--json", ...base, "validate")
      expect(exitCode).toBe(1)
      const result = JSON.parse(stdout) as {
        valid: boolean
        checks: Array<{ name: string; status: string }>
        errors: Array<{ field: string; message: string }>
      }
      const evalsCheck = result.checks.find((check) => check.name === "evals")

      expect(result.valid).toBe(false)
      expect(evalsCheck?.status).toBe("failed")
      expect(result.errors.some((error) => error.field === "evals.smoke.fixture")).toBe(true)
      expect(result.errors.some((error) => error.message === "unknown fixture: missing-fixture")).toBe(true)
    })
  })

  describe("inspect", () => {
    it("inspects the agentic-next workspace path", async () => {
      const result = (await runJson("inspect", AGENTIC_NEXT)) as {
        ok: boolean
        command: string
        root: string
        bundle: { name: string; version: string; schema_version: string; description: string } | null
        inventory: {
          sections: Array<{
            name: string
            kind: string
            count: number
            entries: Array<{ id: string; path: string; locator: string; bytes?: number }>
          }>
          totals: { sections: number; entries: number; markdown_entries: number; data_entries: number }
        } | null
        state: { adapter: string; dir: string } | null
        errors: unknown[]
      }

      if (result.bundle === null || result.inventory === null || result.state === null) {
        throw new Error("inspect did not return loaded bundle details")
      }
      const sections = new Map(result.inventory.sections.map((section) => [section.name, section]))

      expect(result.ok).toBe(true)
      expect(result.command).toBe("inspect")
      expect(result.root).toBe(join(AGENTIC_NEXT, ".agentic"))
      expect(result.bundle.name).toBe("regulated-case-review")
      expect(result.bundle.version).toBe("0.1.0-experimental")
      expect(result.inventory.totals.sections).toBe(13)
      expect(result.inventory.totals.markdown_entries).toBe(5)
      expect(sections.get("prompts")?.count).toBe(2)
      expect(sections.get("prompts")?.entries[0]?.bytes).toBeGreaterThan(0)
      expect(sections.get("actions")?.entries.map((entry) => entry.id)).toContain("surface.receive")
      expect(result.state.adapter).toBe("filesystem")
      expect(result.state.dir).toBe(join(AGENTIC_NEXT, ".agentic", ".data"))
      expect(result.errors).toEqual([])
    })

    it("inspects a direct bundle root", async () => {
      const bundleRoot = join(AGENTIC_NEXT, ".agentic")
      const result = (await runJson("inspect", bundleRoot)) as {
        ok: boolean
        root: string
        manifest_path: string | null
      }

      expect(result.ok).toBe(true)
      expect(result.root).toBe(bundleRoot)
      expect(result.manifest_path).toBe(join(bundleRoot, "agentic.yaml"))
    })

    it("inspects the base-dir workspace with no positional path", async () => {
      const result = (await runJson(
        "--base-dir",
        AGENTIC_NEXT,
        "inspect",
      )) as { ok: boolean; root: string }

      expect(result.ok).toBe(true)
      expect(result.root).toBe(join(AGENTIC_NEXT, ".agentic"))
    })

    it("treats missing local runtime state as inspectable", async () => {
      await writeMinimalInspectBundle(tmpDir)

      const result = (await runJson(...base, "inspect")) as {
        ok: boolean
        state: {
          dir: string
          exists: boolean
          latest: unknown
          runs: { count: number; entries: unknown[] }
          totals: { actions: number; artifacts: number }
        } | null
      }

      if (result.state === null) throw new Error("inspect did not return state details")
      expect(result.ok).toBe(true)
      expect(result.state.dir).toBe(join(tmpDir, ".agentic", ".data"))
      expect(result.state.exists).toBe(false)
      expect(result.state.latest).toBeNull()
      expect(result.state.runs.count).toBe(0)
      expect(result.state.runs.entries).toEqual([])
      expect(result.state.totals.actions).toBe(0)
      expect(result.state.totals.artifacts).toBe(0)
    })

    it("summarizes local runtime state when present", async () => {
      await writeMinimalInspectBundle(tmpDir)
      await writeInspectRuntimeState(tmpDir)

      const result = (await runJson(...base, "inspect")) as {
        ok: boolean
        state: {
          exists: boolean
          latest: { run_id?: unknown } | null
          runs: {
            count: number
            entries: Array<{ id: string; summary_path: string | null; action_log_path: string | null }>
          }
          totals: {
            actions: number
            completed_actions: number
            denied_actions: number
            approval_required_actions: number
            artifacts: number
            approval_request_artifacts: number
          }
        } | null
        warnings: unknown[]
      }

      if (result.state === null) throw new Error("inspect did not return state details")
      const run = result.state.runs.entries[0]

      expect(result.ok).toBe(true)
      expect(result.state.exists).toBe(true)
      expect(result.state.latest?.run_id).toBe("run-001")
      expect(result.state.runs.count).toBe(1)
      expect(run?.id).toBe("run-001")
      expect(run?.summary_path).toBe(join(tmpDir, ".agentic", ".data", "runs", "run-001", "summary.md"))
      expect(run?.action_log_path).toBe(join(tmpDir, ".agentic", ".data", "runs", "run-001", "actions.jsonl"))
      expect(result.state.totals.actions).toBe(2)
      expect(result.state.totals.completed_actions).toBe(1)
      expect(result.state.totals.denied_actions).toBe(0)
      expect(result.state.totals.approval_required_actions).toBe(1)
      expect(result.state.totals.artifacts).toBe(2)
      expect(result.state.totals.approval_request_artifacts).toBe(1)
      expect(result.warnings).toEqual([])
    })

    it("exits 1 with a JSON envelope when the manifest is missing", async () => {
      await mkdir(join(tmpDir, ".agentic"), { recursive: true })

      const { stdout, exitCode } = await run("--json", ...base, "inspect")
      expect(exitCode).toBe(1)
      const result = JSON.parse(stdout) as {
        ok: boolean
        root: string
        manifest_path: string | null
        bundle: null
        inventory: null
        state: null
        errors: Array<{ field: string; message: string }>
      }

      expect(result.ok).toBe(false)
      expect(result.root).toBe(join(tmpDir, ".agentic"))
      expect(result.manifest_path).toBeNull()
      expect(result.bundle).toBeNull()
      expect(result.inventory).toBeNull()
      expect(result.state).toBeNull()
      expect(result.errors[0]?.field).toBe("bundle")
      expect(result.errors[0]?.message).toContain("Missing bundle manifest")
    })
  })

  describe("eval", () => {
    it("evaluates a matching local run", async () => {
      await writeMinimalEvalBundle(tmpDir)
      await writeEvalRuntimeState(tmpDir)

      const result = (await runJson(...base, "eval")) as {
        ok: boolean
        command: string
        root: string
        bundle: { name: string; version: string; schema_version: string } | null
        state: { run_id: string; run_path: string } | null
        evals: Array<{ id: string; ok: boolean; fixture: string | null; checks: Array<{ name: string; ok: boolean }> }>
        errors: unknown[]
      }

      expect(result.ok).toBe(true)
      expect(result.command).toBe("eval")
      expect(result.root).toBe(join(tmpDir, ".agentic"))
      expect(result.bundle?.name).toBe("eval-demo")
      expect(result.state?.run_id).toBe("run-001")
      expect(result.state?.run_path).toBe(join(tmpDir, ".agentic", ".data", "runs", "run-001"))
      expect(result.evals).toHaveLength(1)
      expect(result.evals[0]?.id).toBe("smoke")
      expect(result.evals[0]?.ok).toBe(true)
      expect(result.evals[0]?.fixture).toBe("fixture-001")
      expect(result.evals[0]?.checks.map((check) => check.name)).toEqual([
        "artifacts",
        "actions",
        "approval_required",
        "external_write_executed",
      ])
      expect(result.evals[0]?.checks.every((check) => check.ok)).toBe(true)
      expect(result.errors).toEqual([])
    })

    it("selects one eval with --eval", async () => {
      await writeMinimalEvalBundle(tmpDir, [
        defaultEvalDeclaration(),
        {
          id: "strict",
          data: {
            id: "strict",
            kind: "eval_declaration",
            fixture: "fixture-001",
            expect: { artifacts: ["missing-artifact"] },
          },
        },
      ])
      await writeEvalRuntimeState(tmpDir)

      const result = (await runJson(...base, "eval", "--eval", "smoke")) as {
        ok: boolean
        evals: Array<{ id: string; ok: boolean }>
      }

      expect(result.ok).toBe(true)
      expect(result.evals).toEqual([expect.objectContaining({ id: "smoke", ok: true })])
    })

    it("selects an explicit run with --run", async () => {
      await writeMinimalEvalBundle(tmpDir)
      await writeEvalRuntimeState(tmpDir, "run-001", { includeApprovalArtifact: false })
      await writeEvalRuntimeState(tmpDir, "run-002", { latestRunId: "run-001" })

      const result = (await runJson(...base, "eval", "--run", "run-002")) as {
        ok: boolean
        state: { run_id: string } | null
      }

      expect(result.ok).toBe(true)
      expect(result.state?.run_id).toBe("run-002")
    })

    it("exits 1 with a structured envelope when local runtime state is missing", async () => {
      await writeMinimalEvalBundle(tmpDir)

      const { stdout, exitCode } = await run("--json", ...base, "eval")
      expect(exitCode).toBe(1)
      const result = JSON.parse(stdout) as {
        ok: boolean
        command: string
        state: null
        errors: Array<{ field: string; message: string }>
      }

      expect(result.ok).toBe(false)
      expect(result.command).toBe("eval")
      expect(result.state).toBeNull()
      expect(result.errors[0]?.field).toBe("state")
      expect(result.errors[0]?.message).toContain("no local runtime state found")
    })

    it("fails when an expected artifact type is missing", async () => {
      await writeMinimalEvalBundle(tmpDir)
      await writeEvalRuntimeState(tmpDir, "run-001", { includeApprovalArtifact: false })

      const { stdout, exitCode } = await run("--json", ...base, "eval")
      expect(exitCode).toBe(1)
      const result = JSON.parse(stdout) as {
        ok: boolean
        evals: Array<{
          ok: boolean
          checks: Array<{ name: string; ok: boolean; missing?: string[] }>
          errors: Array<{ field: string; message: string }>
        }>
      }
      const artifactsCheck = result.evals[0]?.checks.find((check) => check.name === "artifacts")

      expect(result.ok).toBe(false)
      expect(result.evals[0]?.ok).toBe(false)
      expect(artifactsCheck?.ok).toBe(false)
      expect(artifactsCheck?.missing).toEqual(["approval-request"])
      expect(result.evals[0]?.errors[0]?.field).toBe("evals.smoke.expect.artifacts")
    })

    it("fails with a structured envelope for an unknown eval id", async () => {
      await writeMinimalEvalBundle(tmpDir)
      await writeEvalRuntimeState(tmpDir)

      const { stdout, exitCode } = await run("--json", ...base, "eval", "--eval", "missing")
      expect(exitCode).toBe(1)
      const result = JSON.parse(stdout) as {
        ok: boolean
        evals: unknown[]
        errors: Array<{ field: string; message: string }>
      }

      expect(result.ok).toBe(false)
      expect(result.evals).toEqual([])
      expect(result.errors[0]?.field).toBe("eval")
      expect(result.errors[0]?.message).toContain("unknown eval declaration: missing")
    })

    it("fails malformed eval declarations with field-specific errors", async () => {
      await writeMinimalEvalBundle(tmpDir, [
        defaultEvalDeclaration({
          expect: {
            artifacts: "case-packet",
            external_write_executed: false,
          },
        }),
      ])
      await writeEvalRuntimeState(tmpDir)

      const { stdout, exitCode } = await run("--json", ...base, "eval")
      expect(exitCode).toBe(1)
      const result = JSON.parse(stdout) as {
        ok: boolean
        evals: Array<{ ok: boolean; errors: Array<{ field: string; message: string }> }>
      }

      expect(result.ok).toBe(false)
      expect(result.evals[0]?.ok).toBe(false)
      expect(result.evals[0]?.errors.some((error) => error.field === "evals.smoke.expect.artifacts")).toBe(true)
      expect(result.evals[0]?.errors.some((error) => error.field === "evals.smoke.expect.external_write_executed")).toBe(true)
    })
  })

  it("routes runtime help", async () => {
    const { stdout, exitCode } = await run(...base, "runtime")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Usage: agentic runtime")
  })

  it("routes runtime list", async () => {
    const result = (await runJson(...base, "runtime", "list")) as {
      runtimes: Array<{ name: string; package_name: string; status: string }>
      note: string
    }
    expect(result.runtimes[0]!.name).toBe("local")
    expect(result.runtimes[0]!.package_name).toBe("@tnezdev/agentic-runtime-local")
    expect(result.runtimes[0]!.status).toBe("available")
    expect(result.note).toContain("Runtime packages are optional")
  })

  it("runtime add records local and gives package guidance when missing", async () => {
    const result = (await runJson(...base, "runtime", "add", "local")) as {
      command: string
      status: string
      runtime: { name: string; package_name: string }
      next_steps: string[]
    }
    expect(result.command).toBe("add")
    expect(result.status).toBe("needs_package")
    expect(result.runtime.package_name).toBe("@tnezdev/agentic-runtime-local")
    expect(result.next_steps.join("\n")).toContain("bun add -d @tnezdev/agentic-runtime-local")

    const config = await readFile(join(tmpDir, ".agentic", "config.toml"), "utf-8")
    expect(config).toContain('[runtime]')
    expect(config).toContain('default = "local"')
    expect(config).toContain('[runtime.local]')
    expect(config).toContain('package = "@tnezdev/agentic-runtime-local"')
  })

  it("runtime add verifies an installed runtime package", async () => {
    await writeRuntimePackage(tmpDir)

    const result = (await runJson(...base, "runtime", "add", "local")) as {
      status: string
      runtime: { status: string }
      result: { data: { manifest: { capabilities: string[] } } }
    }

    expect(result.status).toBe("added")
    expect(result.runtime.status).toBe("configured")
    expect(result.result.data.manifest.capabilities).toContain("run")
  })

  it("runtime add discovers workspace runtime packages from dev package dirs", async () => {
    const nestedBase = join(tmpDir, "examples", "second-brain")
    const packagesDir = join(tmpDir, "packages")
    await mkdir(nestedBase, { recursive: true })
    await writeRuntimeWorkspacePackage(packagesDir)

    const result = (await runJsonWithEnv(
      { AGENTIC_RUNTIME_PACKAGE_DIRS: packagesDir },
      "--base-dir",
      nestedBase,
      "runtime",
      "add",
      "local",
    )) as {
      status: string
      runtime: { status: string }
      result: { data: { manifest: { capabilities: string[] } } }
    }

    expect(result.status).toBe("added")
    expect(result.runtime.status).toBe("configured")
    expect(result.result.data.manifest.capabilities).toContain("run")
  })

  it("runtime add rejects an invalid installed package without writing config", async () => {
    await writeRuntimePackage(
      tmpDir,
      `export const runtime = { kind: "not-agentic", api_version: 1 }
`,
    )

    const { stdout, exitCode } = await run(
      "--json",
      ...base,
      "runtime",
      "add",
      "local",
    )

    expect(exitCode).toBe(1)
    const result = JSON.parse(stdout) as { error: string }
    expect(result.error).toContain("invalid kind")

    const configExists = await Bun.file(join(tmpDir, ".agentic", "config.toml")).exists()
    expect(configExists).toBe(false)
  })

  it("runtime add rejects unknown runtime names", async () => {
    const { stdout, exitCode } = await run(
      "--json",
      ...base,
      "runtime",
      "add",
      "spaceship",
    )
    expect(exitCode).toBe(1)
    const result = JSON.parse(stdout) as { error: string }
    expect(result.error).toContain('Unknown runtime target "spaceship"')
  })

  it("runtime run fails with actionable package guidance when package is missing", async () => {
    const { stdout, exitCode } = await run(
      "--json",
      ...base,
      "runtime",
      "run",
      "inbox-review",
    )
    expect(exitCode).toBe(1)
    const result = JSON.parse(stdout) as { error: string }
    expect(result.error).toContain("@tnezdev/agentic-runtime-local")
    expect(result.error).toContain("bun add -d @tnezdev/agentic-runtime-local")
  })

  it("runtime run delegates to an installed runtime package", async () => {
    await writeRuntimePackage(tmpDir)
    await run(...base, "runtime", "add", "local")

    const result = (await runJson(
      ...base,
      "runtime",
      "run",
      "inbox-review",
      "extra",
    )) as {
      status: string
      result: { data: { target: string; args: string[]; json: boolean } }
    }

    expect(result.status).toBe("delegated")
    expect(result.result.data.target).toBe("inbox-review")
    expect(result.result.data.args).toEqual(["extra"])
    expect(result.result.data.json).toBe(true)
  })

  it("parses interactive as a boolean runtime flag", async () => {
    await writeRuntimePackage(tmpDir)

    const result = (await runJson(
      ...base,
      "run",
      "inbox-review",
      "--interactive",
      "extra",
    )) as {
      status: string
      result: { data: { args: string[]; flags: Record<string, string | true> } }
    }

    expect(result.status).toBe("delegated")
    expect(result.result.data.args).toEqual(["extra"])
    expect(result.result.data.flags.interactive).toBe(true)
  })

  it("top-level run delegates to the default runtime", async () => {
    await writeRuntimePackage(tmpDir)

    const result = (await runJson(...base, "run")) as {
      status: string
      result: { data: { args: string[]; json: boolean } }
    }

    expect(result.status).toBe("delegated")
    expect(result.result.data.args).toEqual([])
    expect(result.result.data.json).toBe(true)
  })

  it("runtime init passes opaque runtime config to the package", async () => {
    await writeRuntimePackage(tmpDir)
    await mkdir(join(tmpDir, ".agentic"), { recursive: true })
    await writeFile(
      join(tmpDir, ".agentic", "config.toml"),
      '[runtime]\ndefault = "local"\n\n[runtime.local]\npackage = "@tnezdev/agentic-runtime-local"\nharness = "pi"\n',
    )

    const result = (await runJson(...base, "runtime", "init")) as {
      status: string
      result: { data: { runtime_config: Record<string, string> } }
    }

    expect(result.status).toBe("delegated")
    expect(result.result.data.runtime_config).toEqual({ harness: "pi" })
  })

  it("runtime init delegates to a workspace runtime package from a nested baseDir", async () => {
    const nestedBase = join(tmpDir, "examples", "second-brain")
    const packagesDir = join(tmpDir, "packages")
    await mkdir(join(nestedBase, ".agentic"), { recursive: true })
    await writeFile(
      join(nestedBase, ".agentic", "config.toml"),
      '[runtime]\ndefault = "local"\n\n[runtime.local]\npackage = "@tnezdev/agentic-runtime-local"\n',
    )
    await writeRuntimeWorkspacePackage(packagesDir)

    const result = (await runJsonWithEnv(
      { AGENTIC_RUNTIME_PACKAGE_DIRS: [packagesDir, join(tmpDir, "missing")].join(delimiter) },
      "--base-dir",
      nestedBase,
      "runtime",
      "init",
      "local",
      "research-loop",
    )) as {
      status: string
      result: { data: { cwd: string; args: string[] } }
    }

    expect(result.status).toBe("delegated")
    expect(result.result.data.cwd).toBe(nestedBase)
    expect(result.result.data.args).toEqual(["research-loop"])
  })

  it("exits 1 on unknown command", async () => {
    const { exitCode, stderr } = await run(...base, "bogus")
    expect(exitCode).toBe(1)
    expect(stderr).toContain("Unknown command")
  })

  describe("init", () => {
    it("scaffolds .agentic/ directory", async () => {
      const result = (await runJson(...base, "init")) as {
        initialized: boolean
        path: string
      }
      expect(result.initialized).toBe(true)
      expect(result.path).toContain(".agentic")
    })

    it("is idempotent", async () => {
      await run(...base, "init")
      const { exitCode } = await run(...base, "init")
      expect(exitCode).toBe(0)
    })

    it("scaffolds the second-brain example", async () => {
      const result = (await runJson(...base, "init", "--example", "second-brain")) as {
        initialized: boolean
        example: string
        filesWritten: number
      }

      expect(result.initialized).toBe(true)
      expect(result.example).toBe("second-brain")
      expect(result.filesWritten).toBeGreaterThan(0)

      const agentBootstrap = await readFile(join(tmpDir, "AGENTS.md"), "utf-8")
      expect(agentBootstrap).toContain("Second-Brain Starter")

      const persona = await runJson(...base, "persona", "list") as Array<{ name: string }>
      expect(persona.map((ref) => ref.name)).toContain("researcher")

      const workflows = await runJson(...base, "workflow", "list") as Array<{ id: string }>
      expect(workflows.map((workflow) => workflow.id)).toContain("research-loop")

      const task = await runJson(...base, "task", "next") as { description: string }
      expect(task.description).toContain("Research lightweight reading queue practices")

      const artifact = await runJson(
        ...base,
        "artifact",
        "inspect",
        "01KTC500000000000000000010",
      ) as { artifact: { type: string; finalized: boolean } }
      expect(artifact.artifact.type).toBe("research-brief")
      expect(artifact.artifact.finalized).toBe(true)
    })

    it("does not overwrite existing files when scaffolding an example", async () => {
      await mkdir(tmpDir, { recursive: true })
      await writeFile(join(tmpDir, "AGENTS.md"), "custom bootstrap")

      const result = (await runJson(...base, "init", "--example", "second-brain")) as {
        filesSkipped: number
      }

      expect(result.filesSkipped).toBeGreaterThan(0)
      await run(...base, "init", "--example", "second-brain")
      expect(await readFile(join(tmpDir, "AGENTS.md"), "utf-8")).toBe("custom bootstrap")
    })
  })

  describe("workflow", () => {
    const graphJson = JSON.stringify({
      id: "test-graph",
      name: "Test Graph",
      version: "1.0",
      nodes: [
        { id: "A", label: "Step A", artifact_type: "doc" },
        { id: "B", label: "Step B", artifact_type: "doc" },
      ],
      edges: [{ from: "A", to: "B" }],
    })

    async function writeGraphFile(dir: string): Promise<string> {
      const { writeFile } = await import("node:fs/promises")
      const path = join(dir, "graph.json")
      await writeFile(path, graphJson)
      return path
    }

    it("create + list round-trip", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)

      const create = await run(...base, "workflow", "create", graphFile)
      expect(create.exitCode).toBe(0)

      const list = (await runJson(...base, "workflow", "list")) as Array<{
        id: string
      }>
      expect(list).toHaveLength(1)
      expect(list[0]!.id).toBe("test-graph")
    })

    it("show displays graph details", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const show = (await runJson(...base, "workflow", "show", "test-graph")) as {
        id: string
        nodes: Array<{ id: string }>
      }
      expect(show.id).toBe("test-graph")
      expect(show.nodes).toHaveLength(2)
    })

    it("run creates a new run", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const result = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string; graph_id: string }
      expect(result.run_id).toBeDefined()
      expect(result.graph_id).toBe("test-graph")
    })

    it("full lifecycle: next -> start -> done -> next -> start -> done", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const created = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string }
      const runId = created.run_id

      // Next should return A
      let next = (await runJson(...base, "workflow", "next", runId)) as string[]
      expect(next).toEqual(["A"])

      // Start A
      const startA = await run(...base, "workflow", "start", runId, "A")
      expect(startA.exitCode).toBe(0)

      // Done A
      const doneA = await run(...base, "workflow", "done", runId, "A")
      expect(doneA.exitCode).toBe(0)

      // Next should return B
      next = (await runJson(...base, "workflow", "next", runId)) as string[]
      expect(next).toEqual(["B"])

      // Start and done B
      await run(...base, "workflow", "start", runId, "B")
      await run(...base, "workflow", "done", runId, "B")

      // Next should be empty
      next = (await runJson(...base, "workflow", "next", runId)) as string[]
      expect(next).toEqual([])
    })

    it("status shows node states", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const created = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string }

      const status = (await runJson(
        ...base,
        "workflow",
        "status",
        created.run_id,
      )) as Record<string, { status: string }>
      expect(status["A"]!.status).toBe("pending")
      expect(status["B"]!.status).toBe("pending")
    })

    it("fail records failure with reason", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const created = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string }
      const runId = created.run_id

      await run(...base, "workflow", "start", runId, "A")
      const fail = await run(
        ...base,
        "workflow",
        "fail",
        runId,
        "A",
        "--reason",
        "timed out",
      )
      expect(fail.exitCode).toBe(0)

      const history = (await runJson(
        ...base,
        "workflow",
        "history",
        runId,
      )) as Array<{ to_status: string; reason?: string }>
      const failEntry = history.find((t) => t.to_status === "failed")
      expect(failEntry).toBeDefined()
      expect(failEntry!.reason).toBe("timed out")
    })

    it("history shows transitions", async () => {
      await run(...base, "init")
      const graphFile = await writeGraphFile(tmpDir)
      await run(...base, "workflow", "create", graphFile)

      const created = (await runJson(
        ...base,
        "workflow",
        "run",
        "test-graph",
      )) as { run_id: string }
      const runId = created.run_id

      await run(...base, "workflow", "start", runId, "A")
      await run(...base, "workflow", "done", runId, "A")

      const history = (await runJson(
        ...base,
        "workflow",
        "history",
        runId,
      )) as Array<{ node_id: string; to_status: string }>
      expect(history).toHaveLength(2)
      expect(history[0]!.to_status).toBe("in_progress")
      expect(history[1]!.to_status).toBe("completed")
    })
  })

  describe("memory", () => {
    it("remember + recall round-trip", async () => {
      await run(...base, "init")

      // Remember
      const remembered = (await runJson(
        ...base,
        "memory",
        "remember",
        "test content",
        "--weight",
        "0.8",
        "--tags",
        "foo,bar",
        "--key",
        "test-key",
      )) as { memory: { key: string; content: string; weight: number; tags: string[] } }

      expect(remembered.memory.key).toBe("test-key")
      expect(remembered.memory.content).toBe("test content")
      expect(remembered.memory.weight).toBe(0.8)
      expect(remembered.memory.tags).toEqual(["foo", "bar"])

      // Recall
      const recalled = (await runJson(
        ...base,
        "memory",
        "recall",
        "test",
      )) as { results: Array<{ memory: { key: string }; score: number }> }

      expect(recalled.results.length).toBe(1)
      expect(recalled.results[0]!.memory.key).toBe("test-key")
    })

    it("reinforce bumps confidence", async () => {
      await run(...base, "init")
      await run(
        ...base,
        "memory",
        "remember",
        "content",
        "--key",
        "r-key",
      )

      // Confidence starts at 1.0, reinforce caps at 1.0
      // Let's check the structure is right
      const result = (await runJson(
        ...base,
        "memory",
        "reinforce",
        "r-key",
      )) as { memory: { key: string; confidence: number } }

      expect(result.memory.key).toBe("r-key")
      expect(result.memory.confidence).toBe(1) // already at max
    })

    it("reinforce fails on unknown key", async () => {
      await run(...base, "init")
      const { exitCode } = await run(
        ...base,
        "memory",
        "reinforce",
        "nonexistent",
      )
      expect(exitCode).toBe(1)
    })

    it("forget removes a memory", async () => {
      await run(...base, "init")
      await run(
        ...base,
        "memory",
        "remember",
        "to forget",
        "--key",
        "f-key",
      )

      const { exitCode } = await run(...base, "memory", "forget", "f-key")
      expect(exitCode).toBe(0)

      // Recall should find nothing
      const recalled = (await runJson(
        ...base,
        "memory",
        "recall",
        "to forget",
      )) as { results: Array<unknown> }
      expect(recalled.results.length).toBe(0)
    })

    it("forget fails on unknown key", async () => {
      await run(...base, "init")
      const { exitCode } = await run(
        ...base,
        "memory",
        "forget",
        "nonexistent",
      )
      expect(exitCode).toBe(1)
    })

    it("dream --dry-run does not mutate", async () => {
      await run(...base, "init")
      await run(
        ...base,
        "memory",
        "remember",
        "important",
        "--key",
        "d-key",
        "--weight",
        "0.9",
      )

      const dreamResult = (await runJson(
        ...base,
        "memory",
        "dream",
        "--dry-run",
      )) as { result: { promoted: string[]; pruned: string[] } }

      expect(dreamResult.result.promoted).toContain("d-key")

      // Memory should still exist and be L1
      const recalled = (await runJson(
        ...base,
        "memory",
        "recall",
        "important",
      )) as { results: Array<{ memory: { key: string; tier: string } }> }
      expect(recalled.results[0]!.memory.tier).toBe("L1")
    })

    it("remember errors without content", async () => {
      await run(...base, "init")
      const { exitCode } = await run(...base, "memory", "remember")
      expect(exitCode).toBe(1)
    })
  })

  describe("persona", () => {
    // Override HOME so the global personas dir points into a scratch
    // directory rather than the developer's real ~/.spores/personas.
    let fakeHome: string

    async function runPersona(
      ...args: string[]
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      const proc = Bun.spawn(["bun", CLI, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: fakeHome },
      })
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
    }

    async function runPersonaJson(...args: string[]): Promise<unknown> {
      const { stdout } = await runPersona("--json", ...args)
      return JSON.parse(stdout)
    }

    async function writePersona(
      dir: string,
      filename: string,
      body: string,
    ): Promise<void> {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, filename), body)
    }

    beforeEach(async () => {
      fakeHome = await mkdtemp(join(tmpdir(), "spores-cli-home-"))
    })

    afterEach(async () => {
      await rm(fakeHome, { recursive: true })
    })

    const SAMPLE = `---
name: spores-maintainer
description: Activate when working on the spores toolbelt
memory_tags: [spores, npm]
skills: [release]
task_filter:
  tags: [spores]
---

You are working on spores.
The cwd is {{cwd}}.
`

    it("list returns empty when no personas exist", async () => {
      const refs = (await runPersonaJson(
        ...base,
        "persona",
        "list",
      )) as unknown[]
      expect(refs).toEqual([])
    })

    it("list shows project personas", async () => {
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "spores-maintainer.md",
        SAMPLE,
      )
      const refs = (await runPersonaJson(
        ...base,
        "persona",
        "list",
      )) as Array<{ name: string; description: string }>
      expect(refs).toHaveLength(1)
      expect(refs[0]!.name).toBe("spores-maintainer")
    })

    it("view returns raw body with unsubstituted tokens", async () => {
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "spores-maintainer.md",
        SAMPLE,
      )
      const file = (await runPersonaJson(
        ...base,
        "persona",
        "view",
        "spores-maintainer",
      )) as { body: string; name: string }
      expect(file.name).toBe("spores-maintainer")
      expect(file.body).toContain("{{cwd}}") // raw — not substituted
    })

    it("activate returns rendered body with substituted tokens", async () => {
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "spores-maintainer.md",
        SAMPLE,
      )
      // activate wraps the rendered persona in a PersonaActivationOutput
      // alongside any hook result (see tnezdev/spores#27). The persona
      // lives under `.persona`; the hook is undefined when no hook fired.
      const result = (await runPersonaJson(
        ...base,
        "persona",
        "activate",
        "spores-maintainer",
      )) as {
        persona: { body: string; situational: { cwd: string } }
        hook?: unknown
      }
      expect(result.persona.body).not.toContain("{{cwd}}") // substituted
      expect(result.persona.body).toContain(result.persona.situational.cwd)
      expect(result.hook).toBeUndefined()
    })

    it("activate fires persona.activated hook and appends its stdout", async () => {
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "spores-maintainer.md",
        SAMPLE,
      )
      // Write an executable hook that echoes env vars — this exercises
      // event firing, env propagation, and output wrapping together.
      const hookDir = join(tmpDir, ".spores", "hooks")
      await mkdir(hookDir, { recursive: true })
      const hookPath = join(hookDir, "persona.activated")
      await writeFile(
        hookPath,
        '#!/usr/bin/env bash\necho "event=$SPORES_EVENT"\necho "name=$SPORES_PERSONA_NAME"\necho "tags=$SPORES_PERSONA_MEMORY_TAGS"\n',
      )
      const { chmod } = await import("node:fs/promises")
      await chmod(hookPath, 0o755)

      const result = (await runPersonaJson(
        ...base,
        "persona",
        "activate",
        "spores-maintainer",
      )) as {
        persona: { body: string }
        hook: { ran: boolean; stdout: string; exit_code: number | null }
      }
      expect(result.hook.ran).toBe(true)
      expect(result.hook.exit_code).toBe(0)
      expect(result.hook.stdout).toContain("event=persona.activated")
      expect(result.hook.stdout).toContain("name=spores-maintainer")
      expect(result.hook.stdout).toContain("tags=spores,npm")
    })

    it("activate exposes routing hints (effort, reasoning) as hook env vars", async () => {
      const HINTED = `---
name: hinted
description: Activate to test hint propagation
memory_tags: [test]
effort: high
reasoning: medium
---

Body.
`
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "hinted.md",
        HINTED,
      )
      const hookDir = join(tmpDir, ".spores", "hooks")
      await mkdir(hookDir, { recursive: true })
      const hookPath = join(hookDir, "persona.activated")
      await writeFile(
        hookPath,
        '#!/usr/bin/env bash\necho "effort=$SPORES_PERSONA_EFFORT"\necho "reasoning=$SPORES_PERSONA_REASONING"\n',
      )
      const { chmod } = await import("node:fs/promises")
      await chmod(hookPath, 0o755)

      const result = (await runPersonaJson(
        ...base,
        "persona",
        "activate",
        "hinted",
      )) as {
        hook: { stdout: string; exit_code: number | null }
      }
      expect(result.hook.stdout).toContain("effort=high")
      expect(result.hook.stdout).toContain("reasoning=medium")
    })

    it("activate exposes empty hint env vars when persona omits them", async () => {
      // Personas without effort/reasoning still get the env vars defined
      // (as empty strings) so hook scripts can rely on them existing.
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "spores-maintainer.md",
        SAMPLE,
      )
      const hookDir = join(tmpDir, ".spores", "hooks")
      await mkdir(hookDir, { recursive: true })
      const hookPath = join(hookDir, "persona.activated")
      await writeFile(
        hookPath,
        '#!/usr/bin/env bash\necho "effort=[$SPORES_PERSONA_EFFORT]"\necho "reasoning=[$SPORES_PERSONA_REASONING]"\n',
      )
      const { chmod } = await import("node:fs/promises")
      await chmod(hookPath, 0o755)

      const result = (await runPersonaJson(
        ...base,
        "persona",
        "activate",
        "spores-maintainer",
      )) as {
        hook: { stdout: string }
      }
      expect(result.hook.stdout).toContain("effort=[]")
      expect(result.hook.stdout).toContain("reasoning=[]")
    })

    it("view fails on missing persona", async () => {
      const { exitCode, stderr } = await runPersona(
        ...base,
        "persona",
        "view",
        "nonexistent",
      )
      expect(exitCode).toBe(1)
      expect(stderr).toContain("Persona not found")
    })

    it("activate fails on missing persona", async () => {
      const { exitCode, stderr } = await runPersona(
        ...base,
        "persona",
        "activate",
        "nonexistent",
      )
      expect(exitCode).toBe(1)
      expect(stderr).toContain("Persona not found")
    })

    it("list truncates long descriptions by default", async () => {
      const longDesc = "A".repeat(80)
      const content = `---\nname: verbose\ndescription: ${longDesc}\n---\n\nBody.\n`
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "verbose.md",
        content,
      )
      const { stdout } = await runPersona(...base, "persona", "list")
      expect(stdout).not.toContain(longDesc)
      expect(stdout).toContain("…")
    })

    it("list --wide shows full descriptions", async () => {
      const longDesc = "A".repeat(80)
      const content = `---\nname: verbose\ndescription: ${longDesc}\n---\n\nBody.\n`
      await writePersona(
        join(tmpDir, ".spores", "personas"),
        "verbose.md",
        content,
      )
      const { stdout } = await runPersona(...base, "--wide", "persona", "list")
      expect(stdout).toContain(longDesc)
    })
  })

  describe("--wide flag", () => {
    it("skill list truncates long descriptions by default", async () => {
      const longDesc = "B".repeat(80)
      const skillDir = join(tmpDir, ".spores", "skills", "verbose")
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        join(skillDir, "skill.md"),
        `---\nname: verbose\ndescription: ${longDesc}\ntags: []\n---\n\nContent.\n`,
      )
      const { stdout } = await run(...base, "skill", "list")
      expect(stdout).not.toContain(longDesc)
      expect(stdout).toContain("…")
    })

    it("skill list --wide shows full descriptions", async () => {
      const longDesc = "B".repeat(80)
      const skillDir = join(tmpDir, ".spores", "skills", "verbose")
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        join(skillDir, "skill.md"),
        `---\nname: verbose\ndescription: ${longDesc}\ntags: []\n---\n\nContent.\n`,
      )
      const { stdout } = await run(...base, "--wide", "skill", "list")
      expect(stdout).toContain(longDesc)
    })

    it("task list truncates long descriptions by default", async () => {
      await run(...base, "init")
      const longDesc = "C".repeat(80)
      await run(...base, "task", "add", longDesc)
      const { stdout } = await run(...base, "task", "list")
      expect(stdout).not.toContain(longDesc)
      expect(stdout).toContain("…")
    })

    it("task list --wide shows full descriptions", async () => {
      await run(...base, "init")
      const longDesc = "C".repeat(80)
      await run(...base, "task", "add", longDesc)
      const { stdout } = await run(...base, "--wide", "task", "list")
      expect(stdout).toContain(longDesc)
    })
  })
})
