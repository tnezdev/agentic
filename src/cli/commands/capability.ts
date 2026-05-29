import { readFile } from "node:fs/promises"
import type { CapabilityDef } from "../../types.js"
import { listCapabilities, loadCapability } from "../../capability/filesystem.js"
import { validateCapability } from "../../capability/helpers.js"
import { FlatFileSource } from "../../sources/flat-file.js"
import { LayeredSource } from "../../sources/layered.js"
import { resolveProjectDir, resolveGlobalDir } from "../../resolve-dir.js"
import {
  formatCapabilityDefs,
  formatCapabilityDef,
  formatCapabilityValidate,
} from "../format.js"
import type { CapabilityValidateResult } from "../format.js"
import type { Command } from "../context.js"
import { output } from "../output.js"

export type { CapabilityValidateResult }

export const capabilityListCommand: Command = async (ctx, _args, _flags) => {
  const defs = await listCapabilities(ctx.baseDir)
  output(ctx, defs, (data) => formatCapabilityDefs(data, ctx.wide))
}

export const capabilityShowCommand: Command = async (ctx, args, _flags) => {
  const name = args[0]
  if (name === undefined) throw new Error("Usage: capability show <name>")

  const def = await loadCapability(name, ctx.baseDir)
  if (def === undefined) throw new Error(`Capability not found: ${name}`)

  output(ctx, def, formatCapabilityDef)
}

export const capabilityValidateCommand: Command = async (ctx, args, _flags) => {
  const subject = args[0]
  if (subject === undefined)
    throw new Error("Usage: capability validate <name-or-file>")

  let result: CapabilityValidateResult

  if (subject.includes("/") || subject.endsWith(".json")) {
    // File path — read directly
    let text: string
    try {
      text = await readFile(subject, "utf-8")
    } catch {
      throw new Error(`File not found: ${subject}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      result = {
        subject,
        valid: false,
        errors: [{ field: ".", message: "file is not valid JSON" }],
      }
      output(ctx, result, formatCapabilityValidate)
      return
    }

    const validation = validateCapability(parsed)
    if (validation.valid) {
      result = { subject, valid: true, capability: parsed as CapabilityDef }
    } else {
      result = { subject, valid: false, errors: validation.errors }
    }
  } else {
    // Capability name — read via the same layered source used by loadCapability
    const source = new LayeredSource([
      new FlatFileSource(resolveProjectDir(ctx.baseDir, "capabilities"), ".json"),
      new FlatFileSource(resolveGlobalDir("capabilities"), ".json"),
    ])

    const record = await source.read(subject)
    if (record === undefined) {
      throw new Error(`Capability not found: ${subject}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(record.text)
    } catch {
      result = {
        subject,
        valid: false,
        errors: [{ field: ".", message: "declaration is not valid JSON" }],
      }
      output(ctx, result, formatCapabilityValidate)
      return
    }

    const validation = validateCapability(parsed)
    if (validation.valid) {
      result = { subject, valid: true, capability: parsed as CapabilityDef }
    } else {
      result = { subject, valid: false, errors: validation.errors }
    }
  }

  output(ctx, result, formatCapabilityValidate)
}
