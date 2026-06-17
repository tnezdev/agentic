import { describe, expect, test } from "bun:test"
import type { ArtifactAttachmentRef, ArtifactDeclaration } from "../types.js"
import {
  validateArtifactAttachmentRef,
  validateArtifactData,
  validateArtifactDeclaration,
} from "./contracts.js"

const validAttachment: ArtifactAttachmentRef = {
  id: "att-left-knee-ap",
  role: "source-image",
  media_type: "application/dicom",
  ref: "runtime://fixtures/case-request-001/dicom/left-knee-ap.dcm",
  name: "left-knee-ap.dcm",
  size_bytes: 245760,
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  metadata: {
    view: "AP",
    laterality: "left",
  },
}

describe("validateArtifactAttachmentRef", () => {
  test("accepts metadata-only refs to runtime-owned bytes", () => {
    expect(validateArtifactAttachmentRef(validAttachment)).toEqual({ valid: true })
  })

  test("rejects malformed required ref fields", () => {
    const result = validateArtifactAttachmentRef({ ...validAttachment, ref: "" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({ field: "attachment.ref", message: "must be a non-empty string" })
    }
  })

  test("rejects non-string media types", () => {
    const result = validateArtifactAttachmentRef({ ...validAttachment, media_type: 12 })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({ field: "attachment.media_type", message: "must be a non-empty string" })
    }
  })

  test("rejects invalid sizes", () => {
    const result = validateArtifactAttachmentRef({ ...validAttachment, size_bytes: -1 })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "attachment.size_bytes",
        message: "size_bytes must be a non-negative integer",
      })
    }
  })

  test("rejects malformed hashes", () => {
    const result = validateArtifactAttachmentRef({ ...validAttachment, sha256: "not-a-hash" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "attachment.sha256",
        message: "sha256 must be a 64-character hex string",
      })
    }
  })
})

describe("validateArtifactData", () => {
  test("accepts small model-facing data with attachment refs", () => {
    expect(validateArtifactData({
      case_id: "CASE-ORTHO-001",
      data_class: "synthetic_regulated_demo",
      attachments: [validAttachment],
    })).toEqual({ valid: true })
  })

  test("rejects malformed attachment refs inside data", () => {
    const result = validateArtifactData({ attachments: [{ ...validAttachment, sha256: "abc" }] })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toMatchObject({ field: "artifact_data.attachments[0].sha256" })
    }
  })
})

describe("validateArtifactDeclaration", () => {
  test("accepts artifact declarations with attachment vocabulary", () => {
    const declaration: ArtifactDeclaration = {
      id: "case-packet",
      kind: "artifact_declaration",
      description: "Normalized case payload.",
      data_classes: ["synthetic_regulated_demo"],
      statuses: ["intake_ready", "validated"],
      required_fields: ["case_id", "attachments"],
      attachments: {
        required: true,
        roles: ["source-image"],
        media_types: ["application/dicom", "image/png"],
      },
      default_tags: ["case-review"],
    }

    expect(validateArtifactDeclaration(declaration)).toEqual({ valid: true })
  })
})
