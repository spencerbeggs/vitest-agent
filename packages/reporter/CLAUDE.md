# vitest-agent-reporter

Named `VitestAgentReporterFactory` implementations only. No Vitest-API code,
no lifecycle hooks, no persistence. Each factory receives a `ReporterKit`
from `vitest-agent-plugin` and returns one or more `VitestAgentReporter`s
whose synchronous `render(input)` method produces `RenderedOutput[]`. The
plugin (`vitest-agent-plugin`) concatenates those outputs and routes them
by target.

## Layout

```text
src/
  index.ts            -- public re-exports
  _kit-context.ts     -- private FormatterContext builder (shared by factories)
  default.ts          -- defaultReporter: env-aware composition; picks a
                         primary formatter from kit.config.format and adds
                         githubSummaryReporter as a sidecar under GitHub Actions.
                         Returns ReadonlyArray<VitestAgentReporter>
  markdown.ts         -- markdownReporter (wraps the `markdown` Formatter; stdout)
  terminal.ts         -- terminalReporter (wraps the `terminal` Formatter; stdout)
  json.ts             -- jsonReporter (wraps the `json` Formatter; stdout)
  silent.ts           -- silentReporter (wraps the `silent` Formatter; no output)
  ci-annotations.ts   -- ciAnnotationsReporter (wraps `ci-annotations`; stdout)
  github-summary.ts   -- githubSummaryReporter (wraps `gfm`; github-summary target)
```

## Key files

| File | Purpose |
| ---- | ------- |
| `default.ts` | `defaultReporter` factory. Env-aware composition: selects primary from `kit.config.format`, adds `githubSummaryReporter` sidecar when `kit.config.githubActions` is true. Returns an array |
| `_kit-context.ts` | Private `FormatterContext` builder shared by the named factories. Constructs `detail`, `noColor`, `coverageConsoleLimit`, `trendSummary`, `runCommand`, `mcp`, `githubSummaryFile` from the `ReporterKit` + `ReporterRenderInput` |
| `markdown.ts` etc. | Six single-formatter factories, each a one-line wrapper over the matching `Formatter` from `vitest-agent-sdk` |

## Conventions

- **No Vitest-API imports.** This package must not import `vitest` or
  `vitest/node`. Vitest lifecycle belongs in `vitest-agent-plugin`.
- **No Effect services.** `render(input)` is synchronous. No
  `Effect.runPromise`, no service tags, no layers.
- **`VitestAgentReporterFactory` contract.** Each export is a factory
  `(kit: ReporterKit) => VitestAgentReporter | ReadonlyArray<VitestAgentReporter>`.
  The contract types (`ReporterKit`, `VitestAgentReporterFactory`,
  `ReporterRenderInput`, `RenderedOutput`) live in `vitest-agent-sdk`.
- **Custom reporters via factory.** Users who want different output
  write their own `VitestAgentReporterFactory` and pass it as
  `reporterFactory` to `AgentPlugin()` from `vitest-agent-plugin`. They do
  not extend classes from this package.
- **Backward-compat re-exports.** `index.ts` re-exports schemas from
  `vitest-agent-sdk` so 1.x consumers importing
  `from "vitest-agent-reporter"` continue to work.

## When working in this package

- Adding a new named factory: follow the `markdown.ts` pattern --
  import the matching `Formatter` from `vitest-agent-sdk`, use
  `_kit-context.ts` to build `FormatterContext`, return a single
  `RenderedOutput` entry. Add the export to `index.ts`.
- Changing `defaultReporter` composition: keep the factory logic in
  `default.ts`. Format selection and GitHub Actions detection are the
  *opinions* this package owns; don't push them into `vitest-agent-plugin`.
- `_kit-context.ts` is private by convention (leading underscore).
  Don't export it from `index.ts`.
- Tests for factory logic go in `src/*.test.ts` next to each factory.
  No `@effect/cli` or Vitest Runner API needed in tests.

## Design references

- `@./.claude/design/vitest-agent/components/reporter.md`
  Load when working on the named factories or `_kit-context` helper.
- `@./.claude/design/vitest-agent/schemas.md`
  Load when working with the public reporter contract types (`ReporterKit`,
  `ReporterRenderInput`, `RenderedOutput`, `VitestAgentReporterFactory`).
- `@./.claude/design/vitest-agent/decisions.md`
  Load for rationale on Decision 34 (plugin/reporter split) and the
  reporter contract.
