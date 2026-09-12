---
"@vitest-agent/sdk": patch
---

## Maintenance

* Regenerated the published `run-report-file-1.0.0.json` JSON Schema with `effect@4.0.0-rc.115`, whose `Schema.toJsonSchemaDocument` now emits object schemas open by default. Every struct in the document changed from `additionalProperties: false` to `additionalProperties: true`, matching how the SDK's own Effect decoders already treated unknown keys. Documents that validated before still validate; the schema no longer rejects extra properties.
