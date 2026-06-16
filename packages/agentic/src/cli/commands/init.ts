import { mkdir, writeFile, access, readdir, readFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
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

const EXAMPLES = new Set(["second-brain"])

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function exampleTemplateDir(name: string): string {
  if (!EXAMPLES.has(name)) {
    throw new Error(`Unknown example "${name}". Known examples: second-brain.`)
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

export const initCommand: Command = async (ctx, _args, flags) => {
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
