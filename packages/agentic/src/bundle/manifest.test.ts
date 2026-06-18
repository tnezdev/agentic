import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { AgenticBundleManifest } from "../types.js"
import { parseYaml } from "../workflow/yaml.js"
import { validateAgenticBundleManifest } from "./manifest.js"

const exampleManifestPath = join(import.meta.dir, "../../../../examples/case-review-bundle/.agentic/agentic.yaml")

async function loadExampleManifest(): Promise<AgenticBundleManifest> {
  const text = await readFile(exampleManifestPath, "utf-8")
  return parseYaml(text) as AgenticBundleManifest
}

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

describe("validateAgenticBundleManifest", () => {
  test("accepts the case-review bundle example manifest", async () => {
    expect(validateAgenticBundleManifest(await loadExampleManifest())).toEqual({ valid: true })
  })

  test("rejects missing required scalar fields", () => {
    const manifest = minimalManifest({ description: "" })
    const result = validateAgenticBundleManifest(manifest)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({ field: "description", message: "must be a non-empty string" })
    }
  })

  test("rejects duplicate principal ids", () => {
    const result = validateAgenticBundleManifest(minimalManifest({
      principals: [{ id: "service:demo" }, { id: "service:demo" }],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "principals[1].id",
        message: "duplicate principal id: service:demo",
      })
    }
  })

  test("rejects duplicate ids within a ref section", () => {
    const result = validateAgenticBundleManifest(minimalManifest({
      artifacts: [
        { id: "case-packet", path: "artifacts/case-packet.yaml" },
        { id: "case-packet", path: "artifacts/case-packet-copy.yaml" },
      ],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "artifacts[1].id",
        message: "duplicate artifacts id: case-packet",
      })
    }
  })

  test("rejects absolute ref paths", () => {
    const result = validateAgenticBundleManifest(minimalManifest({
      prompts: [{ id: "startup", path: "/tmp/startup.md" }],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({ field: "prompts[0].path", message: "path must be relative" })
    }
  })

  test("rejects parent traversal in ref paths", () => {
    const result = validateAgenticBundleManifest(minimalManifest({
      prompts: [{ id: "startup", path: "../startup.md" }],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "prompts[0].path",
        message: "path must not traverse parent directories",
      })
    }
  })

  test("rejects missing known section arrays", () => {
    const manifest = minimalManifest() as unknown as Record<string, unknown>
    delete manifest.fixtures
    const result = validateAgenticBundleManifest(manifest)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({ field: "fixtures", message: "fixtures must be an array" })
    }
  })
})
