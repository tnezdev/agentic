import { mkdir, writeFile, access, readdir, readFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { AGENTIC_BUNDLE_REF_SECTIONS } from "../../bundle/manifest.js"
import type { Command } from "../main.js"
import { output } from "../main.js"

const DEFAULT_CONFIG = `# Agentic configuration
# See: https://github.com/tnezdev/agentic

adapter = "filesystem"

[memory]
dir = ".agentic/memory"
default_tier = "L1"
dream_depth = "3"

[workflow]
graphs_dir = ".agentic/workflows"
runs_dir = ".agentic/runs"
`

const EXAMPLES = ["second-brain", "case-review-bundle"] as const
const EXAMPLE_SET = new Set<string>(EXAMPLES)

const DEFAULT_BUNDLE_MANIFEST = `schema_version: agentic.bundle.v0
name: agentic-bundle
version: 0.1.0
description: Minimal Agentic authored bundle scaffold.
state:
  adapter: filesystem
  dir: .agentic/.data
principals: []
${AGENTIC_BUNDLE_REF_SECTIONS.map((section) => `${section}: []`).join("\n")}
`

const BUNDLE_GITIGNORE_ENTRIES = [".agentic/.data/", ".agentic/runtime/"] as const

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function exampleTemplateDir(name: string): string {
  if (!EXAMPLE_SET.has(name)) {
    throw new Error(`Unknown example "${name}". Known examples: ${EXAMPLES.join(", ")}.`)
  }

  return fileURLToPath(new URL(`../../../templates/${name}/`, import.meta.url))
}

async function listFiles(root: string, dir = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, path))
    } else if (entry.isFile()) {
      files.push(relative(root, path))
    }
  }
  return files.sort()
}

async function writeMissingFile(path: string, content: string): Promise<boolean> {
  if (await exists(path)) return false

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf-8")
  return true
}

async function ensureGitignoreEntries(path: string, entries: readonly string[]): Promise<boolean> {
  if (!await exists(path)) {
    await writeFile(path, `${entries.join("\n")}\n`, "utf-8")
    return true
  }

  const content = await readFile(path, "utf-8")
  const lines = new Set(content.split(/\r?\n/))
  const missing = entries.filter((entry) => !lines.has(entry))
  if (missing.length === 0) return false

  const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n"
  await writeFile(path, `${content}${separator}${missing.join("\n")}\n`, "utf-8")
  return true
}

async function initExample(ctx: Parameters<Command>[0], name: string): Promise<void> {
  const templateDir = exampleTemplateDir(name)
  const agenticDir = join(ctx.baseDir, ".agentic")
  const alreadyExists = await exists(agenticDir)
  let filesWritten = 0
  let filesSkipped = 0

  for (const file of await listFiles(templateDir)) {
    const written = await writeMissingFile(
      join(ctx.baseDir, file),
      await readFile(join(templateDir, file), "utf-8"),
    )
    if (written) filesWritten++
    else filesSkipped++
  }

  await mkdir(join(agenticDir, "memory"), { recursive: true })
  await mkdir(join(agenticDir, "runs"), { recursive: true })

  output(
    ctx,
    {
      initialized: true,
      path: agenticDir,
      example: name,
      alreadyExists,
      filesWritten,
      filesSkipped,
    },
    (d) =>
      d.alreadyExists
        ? `Updated ${d.example} example at ${d.path}`
        : `Initialized ${d.example} example at ${d.path}`,
  )
}

async function initBundle(ctx: Parameters<Command>[0]): Promise<void> {
  const agenticDir = join(ctx.baseDir, ".agentic")
  const alreadyExists = await exists(agenticDir)
  let filesWritten = 0
  let filesSkipped = 0

  await mkdir(agenticDir, { recursive: true })
  for (const section of AGENTIC_BUNDLE_REF_SECTIONS) {
    await mkdir(join(agenticDir, section), { recursive: true })
  }

  if (await writeMissingFile(join(agenticDir, "agentic.yaml"), DEFAULT_BUNDLE_MANIFEST)) {
    filesWritten++
  } else {
    filesSkipped++
  }

  if (await ensureGitignoreEntries(join(ctx.baseDir, ".gitignore"), BUNDLE_GITIGNORE_ENTRIES)) {
    filesWritten++
  } else {
    filesSkipped++
  }

  output(
    ctx,
    {
      initialized: true,
      path: agenticDir,
      bundle: true,
      alreadyExists,
      filesWritten,
      filesSkipped,
    },
    (d) =>
      d.alreadyExists
        ? `Updated authored bundle at ${d.path}`
        : `Initialized authored bundle at ${d.path}`,
  )
}

export const initCommand: Command = async (ctx, _args, flags) => {
  if (flags["bundle"] === true) {
    await initBundle(ctx)
    return
  }

  if (flags["example"] !== undefined) {
    if (typeof flags["example"] !== "string") {
      throw new Error("Usage: agentic init --example <name>")
    }
    await initExample(ctx, flags["example"])
    return
  }

  const agenticDir = join(ctx.baseDir, ".agentic")
  const memoryDir = join(agenticDir, "memory")
  const configPath = join(agenticDir, "config.toml")

  const alreadyExists = await exists(agenticDir)

  await mkdir(memoryDir, { recursive: true })
  await mkdir(join(agenticDir, "workflows"), { recursive: true })
  await mkdir(join(agenticDir, "runs"), { recursive: true })

  if (!alreadyExists) {
    await writeFile(configPath, DEFAULT_CONFIG)
  }

  output(
    ctx,
    { initialized: true, path: agenticDir, alreadyExists },
    (d) =>
      d.alreadyExists
        ? `Already initialized at ${d.path}`
        : `Initialized at ${d.path}`,
  )
}
