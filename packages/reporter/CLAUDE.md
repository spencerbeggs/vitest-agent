# vitest-agent-reporter

The "build your own reporter" escape-hatch SDK for the vitest-agent plugin.
After the 2.0 T6 UI rewrite, the plugin ships its preassembled default
reporter (`_defaultReporter`) inside `vitest-agent-ui`; this package no
longer exports a shipped factory. The only surface here is a one-stop
re-export bundle for custom-reporter authors: the reporter contract types
from `vitest-agent-sdk` and the stream-consumption helpers from
`vitest-agent-ui`. Custom-reporter authors implement
`VitestAgentReporterFactory` and pass the result as the plugin's
`reporter` option.

Open question: 2.x follow-up may fold this package into
`vitest-agent-ui` or `vitest-agent-sdk`. The separation is locked for 2.0
to keep the dependency story clean for custom-reporter authors. The
package retains its own `CURRENT_REPORTER_VERSION` constant so the
plugin's drift check stays wired.

## Layout

```text
src/
  index.ts            -- only file. Re-exports contract types from
                         vitest-agent-sdk + buildDispatchInputs /
                         resolveCellOptions from vitest-agent-ui; exports
                         CURRENT_REPORTER_VERSION for the drift check
```

## Key files

| File | Purpose |
| ---- | ------- |
| `src/index.ts` | The whole package. Re-exports `ResolvedReporterConfig`, `ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `VitestAgentReporter`, `VitestAgentReporterFactory` from the SDK plus `buildDispatchInputs` and `resolveCellOptions` from the UI. Exports `CURRENT_REPORTER_VERSION` for the cross-package drift check. No factories, no formatters, no `_kit-context` helper |

## Conventions

- **No Vitest-API imports.** This package must not import `vitest` or `vitest/node`. Vitest lifecycle belongs in `vitest-agent-plugin`.
- **No factories ship here.** The preassembled default is `_defaultReporter` in `vitest-agent-ui`. Adding a new shipped factory means adding it to `vitest-agent-ui` (alongside the dispatcher matrix it consumes), not this package.
- **Custom reporters via factory.** Users who want different output write their own `VitestAgentReporterFactory` and pass it as the `reporter` option to `AgentPlugin()`. They depend on `vitest-agent-reporter` to pull the contract types and the dispatch helpers from one package.
- **Contract types live in the SDK.** `ReporterKit`, `VitestAgentReporterFactory`, `ReporterRenderInput`, and `RenderedOutput` are defined in `packages/sdk/src/contracts/reporter.ts`. This package re-exports them as a convenience; do not redeclare them here.
- **Dispatch helpers live in the UI.** `buildDispatchInputs` and `resolveCellOptions` are defined in `packages/ui/src/factory/defaultReporter.ts`. This package re-exports them so a custom reporter can reuse the same inputs-assembly the preassembled default uses without taking a direct dependency on `vitest-agent-ui`.

## When working in this package

- The only legitimate edits are: adjusting the re-export surface, updating the package-level docstring, or keeping `CURRENT_REPORTER_VERSION` in sync with the build pipeline. Anything else likely belongs in `vitest-agent-ui` (default reporter, dispatcher cells), `vitest-agent-sdk` (contract types), or `vitest-agent-plugin` (lifecycle wiring).
- Adding a re-export: confirm the symbol genuinely belongs in the public custom-reporter SDK before adding it. Surface bloat here propagates to every downstream consumer.

## Design references

- `@./.claude/design/vitest-agent/components/reporter.md`
  Load for the escape-hatch SDK role and the migration from the pre-T6 named-factory layout.
- `@./.claude/design/vitest-agent/components/ui.md`
  Load when working on `_defaultReporter`, the dispatcher matrix, or the helpers re-exported here.
- `@./.claude/design/vitest-agent/schemas.md`
  Load when working with the public reporter contract types (`ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `VitestAgentReporterFactory`).
- `@./.claude/design/vitest-agent/decisions.md`
  Load for rationale on D34 (plugin/reporter split) and D41 (T6 dispatcher matrix and the preassembled default reporter that absorbed the formatter set).
