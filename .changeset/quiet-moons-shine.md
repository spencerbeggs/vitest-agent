---
"@vitest-agent/mcp": minor
---

## Bug Fixes

Restores the field descriptions that MCP tools advertise on numeric values in their `outputSchema`.

Effect 4.0.0-beta.107 lowers `Schema.Number` to `anyOf: [number, "NaN", "Infinity", "-Infinity"]` and drops any `title` / `description` / `examples` annotation on the way, so every annotated numeric field across the tool surface silently lost its documentation. Numeric result fields now use `Schema.Finite`, which keeps the annotation and lowers to a plain `number` — a closer match for JSON output, where the non-finite values were never representable anyway.

* 29 numeric result fields across 11 tools now carry their descriptions again
* Numeric fields lower to `type: number` instead of a four-branch `anyOf`
* The values these fields carry — row counts, primary keys, durations, and the four `acceptance_metrics` ratios — were already finite, so no tool changes what it emits

### Annotation lifting in the Effect-to-zod bridge

`effectToZodSchema` now hoists JSON Schema annotation keywords out of the `allOf` wrapper that Effect emits for a checked schema, so they reach the served tool schema instead of being buried a level down. Only the annotation vocabulary moves; constraint keywords stay exactly where the lowering put them.
