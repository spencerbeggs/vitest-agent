---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-14
last-synced: 2026-05-14
completeness: 90
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ./plugin.md
  - ./sdk.md
  - ./ui.md
dependencies: []
---

# Reporter package (`vitest-agent-reporter`)

The reporter package contains **named `VitestAgentReporterFactory`
implementations only** — no Vitest-API code. The Vitest lifecycle is owned by
the plugin package; this package is the *opinions* about what output goes
where.

**npm name:** `vitest-agent-reporter`
**Location:** `packages/reporter/`
**Internal dependencies:** `vitest-agent-sdk`

The plugin declares this package as a required `peerDependency` so the default
reporter is always available alongside `agentPlugin()`.

Sibling package `vitest-agent-ui` ships the alternative
`eventSourcedReporter` factory built on top of the `RunEvent` taxonomy
and the shared reducer; both factories satisfy the same
`VitestAgentReporterFactory` contract and users pick which one to wire
via `AgentPlugin({ reporter })`. See [./ui.md](./ui.md) for the
event-sourced renderer.

For the contract types (`VitestAgentReporterFactory`, `VitestAgentReporter`,
`ReporterKit`, `ReporterRenderInput`, `RenderedOutput`) see
[./sdk.md](./sdk.md). For how the plugin invokes the factory and routes its
output, see [./plugin.md](./plugin.md).

---

## The factory pattern

Each named factory wraps **exactly one** shared `Formatter` from
`packages/sdk/src/formatters/`. The factory adds the contract glue
(`render(input) -> RenderedOutput[]`) and constructs the `FormatterContext`;
the formatter remains the single source of truth for content rendering.

| File | Export | Wraps formatter | Output target |
| ---- | ------ | --------------- | ------------- |
| `markdown.ts` | `markdownReporter` | `markdown` | `stdout` |
| `terminal.ts` | `terminalReporter` | `terminal` | `stdout` (plain text + optional ANSI/OSC-8) |
| `json.ts` | `jsonReporter` | `json` | `stdout` |
| `silent.ts` | `silentReporter` | `silent` | none (returns `[]`) |
| `ci-annotations.ts` | `ciAnnotationsReporter` | `ci-annotations` | `stdout` (GitHub Actions workflow commands) |
| `github-summary.ts` | `githubSummaryReporter` | `gfm` | `github-summary` |
| `default.ts` | `defaultReporter` | composes others | varies |

The contract is intentionally a single synchronous
`render(input) -> RenderedOutput[]`. There is no Vitest-lifecycle awareness,
no I/O, no Effect requirements. A no-op reporter is one line:
`() => ({ render: () => [] })`. Custom reporters can wrap a different
formatter, transform `input.reports` before rendering, or return multiple
outputs from one `render()` call.

## `defaultReporter` composition

The default factory returns an **array** of reporters (the contract permits
`VitestAgentReporter | ReadonlyArray<VitestAgentReporter>`). The primary
reporter is selected from `kit.config.format` (`markdown` →
`markdownReporter`, `json` → `jsonReporter`, etc.). Under GitHub Actions,
`githubSummaryReporter` is added as a sidecar so the Step Summary file gets a
GFM appendix in addition to whatever the primary reporter writes to stdout.

The plugin concatenates `RenderedOutput[]` from each entry before routing.
Persistence still runs exactly once per run — the plugin owns the Vitest
lifecycle, and reporters never see Vitest events directly. Returning an array
mirrors Vitest's own multi-reporter pattern.

The composition lives in this package (rather than in the plugin) because
*what output goes where* is the reporter package's concern. Consumers who
fork the default to add a JUnit sidecar or strip the GFM output can publish
their own factory without touching the plugin.

## `_kit-context.ts` helper

Private helper (`packages/reporter/src/_kit-context.ts`) that builds a
`FormatterContext` (`detail`, `noColor`, `coverageConsoleLimit`,
`trendSummary`, `runCommand`, `mcp`, `githubSummaryFile`) from a
`ReporterKit` and the `ReporterRenderInput`'s `trendSummary`. Shared by the
named factories so context construction stays consistent. The leading
underscore marks it as a non-exported implementation detail.

## Why renderer-only

Putting the Vitest contract in the plugin and the rendering surface here
keeps each package responsible for one thing. The plugin can evolve its
lifecycle handling without touching the named factories; consumers can swap
the rendering layer without re-implementing persistence, classification,
baselines, or trends. The `ReporterKit` boundary is the thin pure-data
contract that lets both halves move independently.

## CURRENT_REPORTER_VERSION

`packages/reporter/src/index.ts` exports `CURRENT_REPORTER_VERSION`
(inlined from `process.env.__PACKAGE_VERSION__` via the package's
`rslib.config.ts` `define`). The plugin imports it and compares
against `CURRENT_PLUGIN_VERSION` at the top of the `AgentPlugin()`
factory to surface cross-package drift on stderr — see
[./plugin.md](./plugin.md) and D36 in [../decisions.md](../decisions.md).
The package-local
`packages/reporter/__test__/version-constant.test.ts` imports the
constant through dist/dev (so it sees the substituted literal) and
asserts it equals the package's `package.json#version`.
