import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

function userHome(): string {
  return process.env["HOME"] ?? homedir()
}

/**
 * Resolve a project-level config subdirectory path, preferring `.agentic/`
 * over `.spores/`. Falls back to `.spores/` only when it exists and `.agentic/`
 * does not — preserving legacy projects without migration. Defaults to
 * `.agentic/` for new projects where neither directory exists yet.
 */
export function resolveProjectDir(baseDir: string, ...segments: string[]): string {
  const agenticPath = join(baseDir, ".agentic", ...segments)
  const sporesPath = join(baseDir, ".spores", ...segments)
  if (!existsSync(agenticPath) && existsSync(sporesPath)) return sporesPath
  return agenticPath
}

/**
 * Resolve a global (user-level) config subdirectory path, preferring
 * `~/.agentic/` over `~/.spores/` using the same precedence rules as
 * {@link resolveProjectDir}.
 */
export function resolveGlobalDir(...segments: string[]): string {
  const agenticPath = join(userHome(), ".agentic", ...segments)
  const sporesPath = join(userHome(), ".spores", ...segments)
  if (!existsSync(agenticPath) && existsSync(sporesPath)) return sporesPath
  return agenticPath
}
