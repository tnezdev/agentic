import { resolveBundleRoot } from "../bundle-root.js"
import type { Command, Ctx } from "../context.js"
import {
  formatAgenticDev,
  type AgenticDevPhase,
  type AgenticDevResult,
} from "../format.js"
import { output } from "../output.js"
import { evaluateBundle } from "./eval.js"
import { inspectBundle } from "./inspect.js"
import { delegateDefaultRuntimeRun } from "./runtime.js"
import { validateBundle } from "./validate.js"

export const devCommand: Command = async (ctx, args, flags) => {
  if (args.length > 1) throw new Error("Usage: agentic dev [target]")

  const target = args[0]
  const root = resolveBundleRoot(ctx.baseDir, target)
  const phases: AgenticDevPhase[] = []

  const validation = await validateBundle(root)
  phases.push({ name: "validate", ok: validation.valid, result: validation })
  if (!validation.valid) return finishDev(ctx, root, target, phases)

  const inspection = await inspectBundle(root)
  phases.push({ name: "inspect", ok: inspection.ok, result: inspection })
  if (!inspection.ok) return finishDev(ctx, root, target, phases)

  try {
    const serveFlags: Record<string, string | true> = { ...flags, clean: true }
    const serveArgs = target === undefined ? [] : [target]
    const served = await delegateDefaultRuntimeRun(ctx, serveArgs, serveFlags, {
      outputCommand: "serve",
    })
    phases.push({ name: "serve", ok: served.status === "delegated", result: served })
  } catch (error) {
    phases.push({ name: "serve", ok: false, error: errorMessage(error) })
    return finishDev(ctx, root, target, phases)
  }

  const evaluated = await evaluateBundle(root, {})
  phases.push({ name: "eval", ok: evaluated.ok, result: evaluated })
  return finishDev(ctx, root, target, phases)
}

function finishDev(
  ctx: Ctx,
  root: string,
  target: string | undefined,
  phases: AgenticDevPhase[],
): void {
  const result: AgenticDevResult = {
    command: "dev",
    ok: phases.every((phase) => phase.ok),
    target: target ?? null,
    root,
    phases,
  }
  output(ctx, result, formatAgenticDev)
  if (!result.ok) process.exitCode = 1
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
