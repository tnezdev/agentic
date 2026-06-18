import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { AgenticBundleManifest } from "../types.js"
import { loadAgenticBundle } from "./filesystem.js"

const tempRoots: string[] = []
const exampleRoot = join(import.meta.dir, "../../../../examples/case-review-bundle/.agentic")

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

function minimalManifest(overrides: Partial<AgenticBundleManifest> = {}): AgenticBundleManifest {
  return {
    schema_version: "agentic-bundle.example.v0",
    name: "demo",
    version: "0.1.0",
    description: "Demo bundle.",
    state: { adapter: "filesystem", dir: ".agentic/.data" },
    principals: [{ id: "service:demo", kind: "service" }],
    prompts: [],
    skills: [],
    artifacts: [],
    actions: [],
    capabilities: [],
    hooks: [],
    surfaces: [],
    schedules: [],
    integrations: [],
    policies: [],
    deploy: [],
    evals: [],
    fixtures: [],
    ...overrides,
  }
}

async function writeBundle(
  manifest: AgenticBundleManifest,
  files: Record<string, string> = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentic-bundle-"))
  tempRoots.push(root)
  await writeFile(join(root, "agentic.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8")
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, "utf-8")
  }
  return root
}

describe("loadAgenticBundle", () => {
  test("loads the current case-review bundle declaration inventory", async () => {
    const bundle = await loadAgenticBundle(exampleRoot)
    expect(bundle.manifest.name).toBe("regulated-case-review")
    expect(bundle.prompts).toHaveLength(2)
    expect(bundle.skills).toHaveLength(3)
    expect(bundle.artifacts).toHaveLength(5)
    expect(bundle.actions).toHaveLength(6)
    expect(bundle.capabilities).toHaveLength(2)
    expect(bundle.hooks).toHaveLength(1)
    expect(bundle.surfaces).toHaveLength(1)
    expect(bundle.schedules).toHaveLength(1)
    expect(bundle.integrations).toHaveLength(1)
    expect(bundle.policies).toHaveLength(2)
    expect(bundle.deploy).toHaveLength(1)
    expect(bundle.evals).toHaveLength(1)
    expect(bundle.fixtures).toHaveLength(2)
    expect(bundle.artifacts.find((entry) => entry.id === "case-packet")?.data.kind).toBe("artifact_declaration")
    expect(bundle.skills.find((entry) => entry.id === "validate-case")?.content).toContain("name: validate-case")
  })

  test("rejects missing referenced files", async () => {
    const root = await writeBundle(minimalManifest({
      artifacts: [{ id: "case-packet", path: "artifacts/case-packet.json" }],
    }))

    await expect(loadAgenticBundle(root)).rejects.toThrow("Missing bundle data file for artifacts.case-packet")
  })

  test("rejects declaration id mismatches", async () => {
    const root = await writeBundle(minimalManifest({
      artifacts: [{ id: "case-packet", path: "artifacts/case-packet.json" }],
    }), {
      "artifacts/case-packet.json": JSON.stringify({ id: "other", kind: "artifact_declaration" }),
    })

    await expect(loadAgenticBundle(root)).rejects.toThrow(
      "Declaration id mismatch for artifacts/case-packet.json: manifest has case-packet, file has other",
    )
  })

  test("rejects malformed JSON declarations", async () => {
    const root = await writeBundle(minimalManifest({
      artifacts: [{ id: "case-packet", path: "artifacts/case-packet.json" }],
    }), {
      "artifacts/case-packet.json": "{bad-json",
    })

    await expect(loadAgenticBundle(root)).rejects.toThrow("Invalid JSON data file")
  })

  test("rejects absolute manifest ref paths", async () => {
    const root = await writeBundle(minimalManifest({
      prompts: [{ id: "startup", path: "/tmp/startup.md" }],
    }))

    await expect(loadAgenticBundle(root)).rejects.toThrow("path must be relative")
  })

  test("rejects parent traversal in manifest ref paths", async () => {
    const root = await writeBundle(minimalManifest({
      prompts: [{ id: "startup", path: "../startup.md" }],
    }))

    await expect(loadAgenticBundle(root)).rejects.toThrow("path must not traverse parent directories")
  })
})
