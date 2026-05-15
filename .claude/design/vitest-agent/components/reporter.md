---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-15
last-synced: 2026-05-15
completeness: 88
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

The "build your own reporter" SDK for the `vitest-agent` plugin. After the T6 UI rewrite the plugin ships its own preassembled default reporter from `vitest-agent-ui`; this package no longer carries a shipped default. It is a pure escape-hatch surface: contract types re-exported from the SDK plus stream-consumption helpers a custom reporter typically needs.

**npm name:** `vitest-agent-reporter`
**Location:** `packages/reporter/`
**Internal dependencies:** `vitest-agent-sdk`, `vitest-agent-ui`

The plugin still declares this package as a required `peerDependency` so version-drift detection (T12) has a stable handle and so custom-reporter authors can install one package and pull in everything they need. Separation from `vitest-agent-ui` is locked for 2.0 to keep the dependency story clean for users building custom reporters — the contract types stay out of `vitest-agent-sdk`'s general surface and the UI package's React/Ink peers stay an implementation detail of the default reporter rather than a hard requirement for custom-reporter authors.

For the contract types (`VitestAgentReporterFactory`, `VitestAgentReporter`, `ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `ResolvedReporterConfig`) see [./sdk.md](./sdk.md). For how the plugin invokes the factory and routes its output see [./plugin.md](./plugin.md). For the preassembled default reporter, the dispatcher matrix and the cell helpers see [./ui.md](./ui.md).

---

## What this package exports

`packages/reporter/src/index.ts` is the entire public surface. Two groups:

- **Contract type re-exports from the SDK** — `RenderedOutput`, `ReporterKit`, `ReporterRenderInput`, `ResolvedReporterConfig`, `VitestAgentReporter`, `VitestAgentReporterFactory`. A custom-reporter author imports everything they need from `vitest-agent-reporter` without adding `vitest-agent-sdk` as a direct dependency.
- **Stream-consumption helpers re-exported from `vitest-agent-ui`** — `buildDispatchInputs(state, input, overrides?)` and `resolveCellOptions(kit)`. A custom reporter that wants to reuse the dispatcher's inputs assembly without building its own state projection imports these. The dispatcher itself, the cells and the reducer also live in `vitest-agent-ui` and can be imported directly for hosts that want to compose at a different layer.

---

## What this package no longer exports

The pre-2.0 `defaultReporter`, `markdownReporter`, `terminalReporter`, `jsonReporter`, `silentReporter`, `ciAnnotationsReporter`, `githubSummaryReporter` factories and the private `_kit-context.ts` helper were all deleted in T6. The 2.0 plugin owns the default reporter outright and routes through the dispatcher matrix in `vitest-agent-ui`; the per-formatter pipeline is gone. Hosts that need GFM-flavored Step Summary output, a JSON sink or a CI-annotation emitter implement them as `VitestAgentReporterFactory` instances on top of the stream-consumption helpers and pass the factory as `AgentPlugin({ reporter })`.

---

## Building a custom reporter

The contract is intentionally a single synchronous `render(input) -> RenderedOutput[]`. No Vitest-API awareness, no I/O, no Effect requirements. A no-op reporter is one line: `() => ({ render: () => [] })`.

A custom factory that wants to reuse the dispatcher pipeline composes the helpers from this package plus the dispatcher entry points from `vitest-agent-ui`. The shape is: fold `input.reports` through `synthesizeFromAgentReport` and `reduceRenderStateAll`, build `DispatchInputs` via `buildDispatchInputs`, resolve `CellOptions` from the kit, call `dispatch(inputs, opts)` and return one or more `RenderedOutput` entries. The plugin concatenates and routes by `target`.

The plugin invokes the factory once per run with the resolved `ReporterKit`. The returned `RenderedOutput[]` is routed by `target` (`stdout`, `github-summary`, `file`). See [./plugin.md](./plugin.md) for the routing rules.

---

## Why the separation stays

A custom-reporter author's dependency footprint is small: contract types plus helpers. Folding this package into `vitest-agent-ui` would pull React and Ink into every custom-reporter project; folding it into `vitest-agent-sdk` would push the contract types into every runtime's surface (CLI, MCP, plugin) when only the plugin and the UI package need them. Keeping `vitest-agent-reporter` as a thin re-export package is the boundary that lets the plugin internals evolve without breaking custom-reporter authors and keeps the SDK's surface focused on persistence and shared services.

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
