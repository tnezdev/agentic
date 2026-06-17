# Artifact Contracts

Artifact contracts distinguish small model-facing artifact data from large runtime-owned bytes.

Core owns the portable vocabulary:

- `ArtifactType` is domain/application-specific, such as `case-packet`, `validation-result`, or `handoff-note`.
- `ArtifactData` is the small JSON-like body a model or skill can safely inspect in full.
- `ArtifactAttachmentRef` is metadata-only: `id`, `role`, `media_type`, opaque `ref`, and optional `name`, `size_bytes`, `sha256`, and `metadata`.
- `ArtifactDeclaration` describes authored artifact kinds in a bundle. Runtime artifact instances still live in runtime-owned state.

Core does not interpret attachment storage. `ref` may point at local files, object storage, a blob table, or another runtime-owned locator, but Agentic does not require GCS, signed URLs, DICOM parsing, PDF parsing, or any provider-specific type.

Example attachment ref:

```json
{
  "id": "att-left-knee-ap",
  "role": "source-image",
  "media_type": "application/dicom",
  "ref": "runtime://fixtures/case-request-001/dicom/left-knee-ap.dcm",
  "name": "left-knee-ap.dcm",
  "size_bytes": 245760,
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "metadata": {
    "view": "AP",
    "laterality": "left"
  }
}
```

Runtime adapters own byte access, authorization, rendering, indexing, and any media-specific extraction. Harnesses should receive only the small artifact data and selected attachment metadata unless the runtime deliberately exposes a narrower byte-read capability.
