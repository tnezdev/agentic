import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { JsonObject, JsonValue } from "../../packages/agentic/src/index.ts"
import type {
  LocalActionHandler,
  LocalBundleArtifactRecord,
  LocalBundleHandlerFactoryContext,
} from "../../packages/agentic-runtime-local/src/index.ts"

// Spike retained for current `agentic serve .` execution. The target dogfood
// path moves release-readiness synthesis into Pi plus Agentic-aware tools.

type PackageJson = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function repoRoot(context: LocalBundleHandlerFactoryContext): string {
  return resolve(context.bundle.root, "..")
}

function readPackage(root: string, path: string): PackageJson {
  return JSON.parse(readFileSync(resolve(root, path), "utf-8")) as PackageJson
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

function stringArray(output: string | null): string[] {
  if (output === null || output === "") return []
  return output.split("\n").map((line) => line.trim()).filter(Boolean)
}

function jsonObject(value: JsonValue | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function releaseSequence(): string[] {
  return [
    "Choose the next semver version.",
    "Open and merge a chore: release vX.Y.Z PR after CI is green.",
    "Bump packages/agentic and packages/agentic-runtime-local versions together.",
    "Keep @tnezdev/agentic-runtime-local peer/dev dependency ranges aligned.",
    "Add release notes for user-visible changes since the previous tag.",
    "Confirm packages/agentic/package.json still has no production dependencies.",
    "Sync main locally and verify HEAD is the merged release commit.",
    "Create and push an annotated vX.Y.Z tag.",
    "Let .github/workflows/publish.yml publish through npm Trusted Publishing.",
    "Watch the publish workflow finish green.",
    "Verify npm registry versions for both packages.",
    "Run bash scripts/post-publish-check.sh X.Y.Z.",
    "Verify npm provenance badges for both packages.",
  ]
}

function recommendation(input: {
  versionsAligned: boolean
  dependencyRangesAligned: boolean
  coreHasProductionDependencies: boolean
  versionAlreadyTagged: boolean
  dirtyFiles: string[]
}): { status: string; text: string; blockers: string[] } {
  const blockers: string[] = []
  if (!input.versionsAligned) blockers.push("Package versions are not aligned.")
  if (!input.dependencyRangesAligned) blockers.push("Runtime package peer/dev dependency ranges are not aligned with the core package version.")
  if (input.coreHasProductionDependencies) blockers.push("Core package has production dependencies.")
  if (input.versionAlreadyTagged) blockers.push("Current package version is already tagged; bump version before release.")
  if (input.dirtyFiles.length > 0) blockers.push("Worktree has uncommitted changes.")

  if (blockers.length > 0) {
    const versionBlocker = blockers.some((blocker) => blocker.includes("already tagged"))
    return {
      status: versionBlocker ? "needs_version_bump" : "blocked",
      text: "Do not cut a release yet. Resolve the listed blockers, then rerun release readiness.",
      blockers,
    }
  }

  return {
    status: "needs_checks",
    text: "Release metadata is aligned. Run the required checks and confirm release notes before requesting release-cut approval.",
    blockers: ["Checks are not executed by this local readiness handler."],
  }
}

export function assessReleaseReadiness(
  context: LocalBundleHandlerFactoryContext,
): LocalActionHandler<LocalBundleArtifactRecord> {
  return async ({ action_id, proposal }) => {
    const root = repoRoot(context)
    const corePackage = readPackage(root, "packages/agentic/package.json")
    const runtimePackage = readPackage(root, "packages/agentic-runtime-local/package.json")
    const latestTag = git(root, ["describe", "--tags", "--abbrev=0"])
    const head = git(root, ["rev-parse", "--short", "HEAD"])
    const branch = git(root, ["branch", "--show-current"])
    const dirtyFiles = stringArray(git(root, ["status", "--short"]))
    const commitsSinceTag = latestTag === null ? [] : stringArray(git(root, ["log", "--oneline", `${latestTag}..HEAD`]))
    const coreVersion = corePackage.version ?? "unknown"
    const runtimeVersion = runtimePackage.version ?? "unknown"
    const expectedRange = `^${coreVersion}`
    const runtimePeerRange = runtimePackage.peerDependencies?.["@tnezdev/agentic"] ?? null
    const runtimeDevRange = runtimePackage.devDependencies?.["@tnezdev/agentic"] ?? null
    const rec = recommendation({
      versionsAligned: coreVersion === runtimeVersion,
      dependencyRangesAligned: runtimePeerRange === expectedRange && runtimeDevRange === expectedRange,
      coreHasProductionDependencies: Object.keys(corePackage.dependencies ?? {}).length > 0,
      versionAlreadyTagged: latestTag === `v${coreVersion}`,
      dirtyFiles,
    })

    const body: JsonObject = {
      generated_at: new Date().toISOString(),
      recommendation: {
        status: rec.status,
        summary: rec.text,
        blockers: rec.blockers,
      },
      package_versions: {
        core: coreVersion,
        local_runtime: runtimeVersion,
        versions_aligned: coreVersion === runtimeVersion,
        expected_agentic_range: expectedRange,
        runtime_peer_range: runtimePeerRange,
        runtime_dev_range: runtimeDevRange,
      },
      git: {
        branch,
        head,
        latest_tag: latestTag,
        commits_since_latest_tag: commitsSinceTag,
        dirty_files: dirtyFiles,
      },
      checks: [
        { name: "bun test", status: "not_run", command: "bun test" },
        { name: "typecheck", status: "not_run", command: "bun run typecheck" },
        { name: "build", status: "not_run", command: "bun run build" },
      ],
      release_sequence: releaseSequence(),
      approval_boundary: {
        action: "release.cut",
        required: true,
        effects: ["git.tag:release", "git.push:tag", "ci.trigger:publish"],
      },
      source: jsonObject(proposal.payload),
    }

    const artifact = await context.store.writeArtifact({
      id: context.store.nextId("art_release_readiness_report"),
      type: "release-readiness-report",
      title: `Release readiness for ${coreVersion}`,
      status: rec.status,
      data_class: proposal.data_class,
      tags: ["release", "readiness", `status:${rec.status}`],
      body,
      created_by_action_id: action_id,
    })

    return { artifacts: [artifact] }
  }
}

export function releaseCutRequiresMaintainer(): LocalActionHandler<LocalBundleArtifactRecord> {
  return async () => {
    throw new Error("release.cut is approval-gated and host-owned; the local dogfood bundle does not tag, push, or publish.")
  }
}
