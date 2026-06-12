import type {
  RuntimeCommandName,
  RuntimeCommandOutput,
  RuntimeListOutput,
  RuntimeRef,
} from "../../types.js"
import type { Command } from "../context.js"
import {
  formatRuntimeAction,
  formatRuntimeHelp,
  formatRuntimeList,
} from "../format.js"
import { output } from "../output.js"

const PACKAGE_DISCOVERY_NOTE =
  "Runtime packages are optional. This slice adds the CLI namespace only; package install, config writes, discovery, and delegation are intentionally deferred."

const OFFICIAL_RUNTIMES: RuntimeRef[] = [
  {
    name: "local",
    package_name: "@tnezdev/agentic-runtime-local",
    description: "Run Agentic workspaces on the local machine.",
    status: "known",
    capabilities: ["init", "run", "status"],
    install_command: "bun add -d @tnezdev/agentic-runtime-local",
  },
]

const RUNTIME_HELP = `Usage: agentic runtime <command> [args]

Runtime packages are optional packages that make Agentic workspaces runnable.
Core Agentic provides this CLI front door; runtime packages own harness and
platform integration.

Commands:
  runtime list              List known runtime targets
  runtime add <name>        Show package guidance for a runtime target
  runtime init [name]       Initialize a configured runtime target
  runtime run [target]      Run a target with the default runtime
  runtime status [name]     Show runtime availability guidance`

function knownRuntimeNames(): string {
  return OFFICIAL_RUNTIMES.map((runtime) => runtime.name).join(", ")
}

function getRuntime(name: string): RuntimeRef {
  const runtime = OFFICIAL_RUNTIMES.find((candidate) => candidate.name === name)
  if (runtime === undefined) {
    throw new Error(
      `Unknown runtime target "${name}". Known official targets: ${knownRuntimeNames()}.`,
    )
  }
  return runtime
}

function runtimeAction(
  command: RuntimeCommandName,
  runtime: RuntimeRef,
  status: RuntimeCommandOutput["status"],
  message: string,
  target?: string | undefined,
): RuntimeCommandOutput {
  return {
    command,
    runtime,
    ...(target !== undefined ? { target } : {}),
    status,
    message,
    next_steps: [
      `Runtime package: ${runtime.package_name}`,
      `Install command once the package exists: ${runtime.install_command}`,
      "Next runtime slice: package discovery, config writes, and command delegation.",
    ],
  }
}

function unavailableError(
  command: RuntimeCommandName,
  runtime: RuntimeRef,
  target?: string | undefined,
): Error {
  const action = runtimeAction(
    command,
    runtime,
    "needs_package",
    `Cannot ${command} with runtime "${runtime.name}" yet because runtime package discovery/delegation is not implemented in core.`,
    target,
  )
  return new Error([action.message, ...action.next_steps].join(" "))
}

export const runtimeHelpCommand: Command = async (ctx) => {
  output(ctx, RUNTIME_HELP, formatRuntimeHelp)
}

export const runtimeListCommand: Command = async (ctx) => {
  const result: RuntimeListOutput = {
    runtimes: OFFICIAL_RUNTIMES,
    note: PACKAGE_DISCOVERY_NOTE,
  }
  output(ctx, result, formatRuntimeList)
}

export const runtimeAddCommand: Command = async (ctx, args) => {
  const name = args[0]
  if (name === undefined) throw new Error("Usage: agentic runtime add <name>")

  const runtime = getRuntime(name)
  const result = runtimeAction(
    "add",
    runtime,
    "recognized",
    `Runtime target "${runtime.name}" resolves to ${runtime.package_name}. This command does not mutate config until package discovery lands.`,
  )
  output(ctx, result, formatRuntimeAction)
}

export const runtimeInitCommand: Command = async (_ctx, args) => {
  const runtime = getRuntime(args[0] ?? "local")
  throw unavailableError("init", runtime)
}

export const runtimeRunCommand: Command = async (_ctx, args) => {
  const runtime = getRuntime("local")
  throw unavailableError("run", runtime, args[0])
}

export const runtimeStatusCommand: Command = async (ctx, args) => {
  const runtime = getRuntime(args[0] ?? "local")
  const result = runtimeAction(
    "status",
    runtime,
    "needs_package",
    `Runtime target "${runtime.name}" is known, but runtime package discovery/delegation is not implemented yet.`,
  )
  output(ctx, result, formatRuntimeAction)
}
