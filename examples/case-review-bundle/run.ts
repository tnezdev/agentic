import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type {
  LoadedAgenticBundle,
  RuntimeCommandFlags,
  RuntimeContext,
} from "../../packages/agentic/src/index.ts"
import { loadAgenticBundle } from "../../packages/agentic/src/index.ts"
import { runtime } from "../../packages/agentic-runtime-local/src/index.ts"

type DemoResult = {
  run_id: string
  run_dir: string
  summary_path: string
  latest_path: string
  approval_required_action_id: string
  approval_request_artifact_id: string
  actions: Array<{ id: string; type: string; status: string; capability?: string | undefined }>
  artifacts: Array<{ id: string; type: string; title: string; status: string }>
}

const EXAMPLE_ROOT = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(EXAMPLE_ROOT, "../..")
const BUNDLE_ROOT = join(EXAMPLE_ROOT, ".agentic")
const EXAMPLE_TARGET = "examples/case-review-bundle"

async function loadBundle(): Promise<LoadedAgenticBundle> {
  return loadAgenticBundle(BUNDLE_ROOT)
}

function runtimeContext(): RuntimeContext {
  return {
    cwd: REPO_ROOT,
    workspace_root: REPO_ROOT,
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
}

async function runCaseReviewDemo(options: { clean: boolean }): Promise<DemoResult> {
  const flags: RuntimeCommandFlags = {}
  if (options.clean) flags.clean = true
  const result = await runtime.commands.run!(runtimeContext(), {
    target: EXAMPLE_TARGET,
    args: [],
    flags,
  })
  if (result?.data === undefined) throw new Error("Local runtime did not return demo result data.")
  return result.data as DemoResult
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2))
  const latest = await runCaseReviewDemo({ clean: flags.has("--clean") })

  if (flags.has("--json")) {
    console.log(JSON.stringify(latest, null, 2))
    return
  }

  console.log(`Case review bundle demo run: ${latest.run_id}`)
  console.log(`Summary: ${latest.summary_path}`)
  console.log(`Latest pointer: ${latest.latest_path}`)
  console.log(`Approval required: ${latest.approval_required_action_id}`)
  console.log(`Approval request artifact: ${latest.approval_request_artifact_id}`)
}

if (import.meta.main) {
  await main()
}

export { loadBundle, runCaseReviewDemo }
