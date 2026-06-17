# Authoring a Custom vitest-agent Reporter

## When to use

You want output behavior that the named factories in `vitest-agent-reporter` (`defaultReporter`, `markdownReporter`, `jsonReporter`, etc.) do not provide. Examples: SARIF output for code-scanning ingestion, JUnit XML alongside the default markdown, a side-channel that posts to an internal API.

## The contract

A reporter is a function that takes a `ReporterKit` and returns either a single `VitestAgentReporter` or an array. A reporter has exactly one method: synchronous `render(input)` that returns `RenderedOutput[]`. No I/O, no Vitest lifecycle. The plugin handles persistence, classification, baselines, and trends; reporters render the resulting data and the plugin routes the outputs to their declared targets.

```typescript
type VitestAgentReporterFactory =
 (kit: ReporterKit) =>
  VitestAgentReporter | ReadonlyArray<VitestAgentReporter>;

interface VitestAgentReporter {
 readonly render:
  (input: ReporterRenderInput) => ReadonlyArray<RenderedOutput>;
}
```

`ReporterKit` carries `config`, `stdEnv`, and `stdOsc8` (a pre-bound hyperlink helper). `ReporterRenderInput` carries `reports` (one per project), `classifications` (a Map keyed by `TestReport.fullName`), and an optional `trendSummary`.

## Minimal example: a SARIF sidecar

```typescript
import type { VitestAgentReporterFactory } from "@vitest-agent/sdk";

export const sarifReporter: VitestAgentReporterFactory = (kit) => ({
 render: (input) => {
  const sarif = buildSarif(input.reports);
  return [
   {
    target: "file",
    content: JSON.stringify(sarif),
    contentType: "application/sarif+json",
   },
  ];
 },
});
```

The `target: "file"` slot is reserved for arbitrary on-disk artifacts; the convention for resolving the path will land in a future minor (currently a no-op routing target). Until then, use `target: "stdout"` for output that should reach the user immediately.

## Composing with the default

If you want your reporter to layer on top of the default rather than replace it, return an array:

```typescript
import { defaultReporter, type VitestAgentReporterFactory } from "@vitest-agent/reporter";

export const myReporter: VitestAgentReporterFactory = (kit) => {
 const inner = defaultReporter(kit);
 const innerArr = Array.isArray(inner) ? inner : [inner];
 return [...innerArr, sarifReporter(kit)];
};
```

## Wiring into the plugin

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { agentPlugin } from "@vitest-agent/plugin";
import { myReporter } from "./my-reporter.js";

export default defineConfig({
 plugins: [agentPlugin({ reporterFactory: myReporter })],
});
```

## Anti-patterns

- **Don't reach into Vitest's lifecycle from a reporter.** The plugin owns it. If you need a Vitest hook, you have outgrown this contract — fork the plugin instead.
- **Don't return Promises from `render`.** The contract is sync. If you have async work, do it ahead of time and pass the resolved data into your factory closure.
- **Don't use `stdOsc8` outside terminal targets.** OSC-8 escapes only render in capable terminals; `kit.stdOsc8` already gates this for you. Calling it from a `target: "github-summary"` reporter is harmless (it returns the bare label) but signals confused intent.

## See also

- `vitest://docs/advanced/reporters` — Vitest's own reporter API (different surface; informative for context)
- `packages/reporter/src/default.ts` — The composition pattern the default reporter uses
- `packages/sdk/src/contracts/reporter.ts` — Full type definitions for the contract
