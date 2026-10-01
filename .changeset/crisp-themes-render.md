---
"@vitest-agent/ui": major
---

## Breaking Changes

- Removed `GlyphSetContext`, `spinnerFrameForTime`, and the `glyphs` prop on `StreamApp`. Glyphs and colors now come from the shared theme.
- `SPINNER_FRAMES` is typed `ReadonlyArray<string>`.
- `@effected/cli`, `@effected/env`, `@effected/glob`, and `@effected/walker` are now peer dependencies.

## Features

- New theme exports built on `@effected/cli`: `VitestAgentStatus`, `VitestAgentTokens`, `inkStyle`, `statusGlyph`, and `statusInkStyle`.

## Other

Rendered output changed: skipped glyphs and pending items are dimmed, regressing trends are yellow, coverage violations show a red `✗`, and durations read like `250ms` and `1m 5s`.
