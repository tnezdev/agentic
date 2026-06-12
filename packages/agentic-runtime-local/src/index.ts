import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"
import type {
  AgenticRuntimePackage,
  RuntimeCommandResult,
  RuntimeContext,
  RuntimeInitArgs,
  RuntimeRunArgs,
  RuntimeStatusArgs,
} from "@tnezdev/agentic/runtime"

const RUNTIME_NAME = "local"
const PACKAGE_NAME = "@tnezdev/agentic-runtime-local"
const STATE_VERSION = 1
const RUNTIME_DIR = join(".agentic", "runtime", RUNTIME_NAME)
const TARGETS_DIR = "targets"
const STATE_FILE = "runtime.json"

type LocalRuntimeState = {
  version: typeof STATE_VERSION
  runtime: typeof RUNTIME_NAME
  package_name: typeof PACKAGE_NAME
  targets_dir: typeof TARGETS_DIR
}

function runtimeDir(ctx: RuntimeContext): string {
  return join(ctx.workspace_root, RUNTIME_DIR)
}

function targetsDir(ctx: RuntimeContext): string {
  return join(runtimeDir(ctx), TARGETS_DIR)
}

function statePath(ctx: RuntimeContext): string {
  return join(runtimeDir(ctx), STATE_FILE)
}

function workspaceRelative(ctx: RuntimeContext, path: string): string {
  return relative(ctx.workspace_root, path) || "."
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function readState(ctx: RuntimeContext): Promise<LocalRuntimeState | undefined> {
  try {
    return JSON.parse(await readFile(statePath(ctx), "utf-8")) as LocalRuntimeState
  } catch {
    return undefined
  }
}

async function initLocalRuntime(
  ctx: RuntimeContext,
  _args: RuntimeInitArgs,
): Promise<RuntimeCommandResult> {
  const dir = runtimeDir(ctx)
  const targetDir = targetsDir(ctx)
  const path = statePath(ctx)
  await mkdir(targetDir, { recursive: true })

  const existing = await readState(ctx)
  const created = existing === undefined
  if (created) {
    const state: LocalRuntimeState = {
      version: STATE_VERSION,
      runtime: RUNTIME_NAME,
      package_name: PACKAGE_NAME,
      targets_dir: TARGETS_DIR,
    }
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8")
  }

  return {
    summary: created
      ? "Initialized local Agentic runtime glue."
      : "Local Agentic runtime glue is already initialized.",
    data: {
      initialized: true,
      created,
      config_dir: workspaceRelative(ctx, dir),
      state_path: workspaceRelative(ctx, path),
      targets_dir: workspaceRelative(ctx, targetDir),
    },
  }
}

async function runLocalRuntime(
  ctx: RuntimeContext,
  args: RuntimeRunArgs,
): Promise<RuntimeCommandResult> {
  return {
    summary: "Local runtime execution is not implemented yet.",
    data: {
      target: args.target ?? null,
      args: args.args,
      initialized: await pathExists(statePath(ctx)),
    },
  }
}

async function statusLocalRuntime(
  ctx: RuntimeContext,
  _args: RuntimeStatusArgs,
): Promise<RuntimeCommandResult> {
  const initialized = await pathExists(statePath(ctx))
  return {
    summary: initialized
      ? "Local Agentic runtime glue is initialized."
      : "Local runtime package is installed; run `agentic runtime init local` to create local glue.",
    data: {
      initialized,
      state_path: workspaceRelative(ctx, statePath(ctx)),
      targets_dir: workspaceRelative(ctx, targetsDir(ctx)),
      targets_dir_exists: await dirExists(targetsDir(ctx)),
    },
  }
}

export const runtime: AgenticRuntimePackage = {
  kind: "agentic-runtime",
  api_version: 1,
  name: RUNTIME_NAME,
  package_name: PACKAGE_NAME,
  description: "Run Agentic workspaces on the local machine.",
  capabilities: ["init", "run", "status"],
  commands: {
    init: initLocalRuntime,
    run: runLocalRuntime,
    status: statusLocalRuntime,
  },
}

export default runtime
