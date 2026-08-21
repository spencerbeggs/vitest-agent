---
"@vitest-agent/sdk": patch
---

## Bug Fixes

`classifyTestPath` no longer matches a helper directory name (e.g. `utils`) at any depth under `__test__/` — only a helper directory named directly beneath the test root counts as excluded. This is what the `test-location` PreToolUse hook acts on: because an "excluded" verdict makes the hook deny creating the file, the any-depth match wrongly blocked authoring a legitimate test at a nested helper-named path such as `__test__/unit/utils/parse.test.ts`.

The wrap-up guidance string for open hypotheses no longer instructs callers to pass `validatedAt`, matching `hypothesis({ action: "validate" })` now defaulting it server-side when omitted.
