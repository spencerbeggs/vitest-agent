---
"@vitest-agent/sdk": major
---

## Breaking Changes

Removed the unused pure formatters `TerminalFormatter`, `GfmFormatter`, `JsonFormatter`, `MarkdownFormatter`, `SilentFormatter` and `ciAnnotationsFormatter`, along with the `Formatter` and `FormatterContext` types. Their only caller was the engine's `OutputRenderer`, which nothing in production used. Reporter output is rendered by `@vitest-agent/ui` and `@effected/cli`. `RenderedOutput` is unchanged.
