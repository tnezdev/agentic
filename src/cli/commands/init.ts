import { mkdir, writeFile, access } from "node:fs/promises"
import { join } from "node:path"
import type { Command } from "../main.js"
import { output } from "../main.js"

const DEFAULT_CONFIG = `# Agentic configuration
# See: https://github.com/tnezdev/spores

adapter = "filesystem"

[memory]
dir = ".agentic/memory"
default_tier = "L1"
dream_depth = "3"

[workflow]
graphs_dir = ".agentic/workflows"
runs_dir = ".agentic/runs"
`

export const initCommand: Command = async (ctx, _args, _flags) => {
  const agenticDir = join(ctx.baseDir, ".agentic")
  const memoryDir = join(agenticDir, "memory")
  const configPath = join(agenticDir, "config.toml")

  let alreadyExists = false
  try {
    await access(agenticDir)
    alreadyExists = true
  } catch {
    // doesn't exist, we'll create it
  }

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
