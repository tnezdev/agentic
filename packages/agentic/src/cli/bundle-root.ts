import { existsSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { AGENTIC_BUNDLE_MANIFEST_FILENAMES } from "../bundle/filesystem.js"

export function resolveBundleRoot(baseDir: string, subject: string | undefined): string {
  const base = resolve(baseDir)
  if (subject === undefined) {
    const workspaceBundle = join(base, ".agentic")
    if (hasBundleManifest(workspaceBundle)) return workspaceBundle
    if (hasBundleManifest(base)) return base
    if (existsSync(workspaceBundle)) return workspaceBundle
    return base
  }

  const target = isAbsolute(subject) ? resolve(subject) : resolve(base, subject)
  if (hasBundleManifest(target)) return target

  const workspaceBundle = join(target, ".agentic")
  if (hasBundleManifest(workspaceBundle) || existsSync(workspaceBundle)) return workspaceBundle
  return target
}

export function hasBundleManifest(dir: string): boolean {
  return AGENTIC_BUNDLE_MANIFEST_FILENAMES.some((filename) => existsSync(join(dir, filename)))
}

export function workspaceRootForBundleRoot(bundleRoot: string): string {
  const root = resolve(bundleRoot)
  return basename(root) === ".agentic" ? dirname(root) : root
}
