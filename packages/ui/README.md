# @vitest-agent/ui

[![npm](https://img.shields.io/npm/v/@vitest-agent/ui?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Part of the [vitest-agent](https://vitest-agent.dev) ecosystem.** Most users want **[@vitest-agent/plugin](https://www.npmjs.com/package/@vitest-agent/plugin)**, which pulls this package in automatically. Install `@vitest-agent/ui` directly only if you build custom rendering on the primitives.

Pure rendering primitives for vitest-agent. Owns the `RunEvent` reducer, the shape-tailored 12-cell dispatcher matrix, two render paths (agent string and React Ink tree), a PubSub channel for live event transport, and the synthesizers that bridge live Vitest data and stored reports into the event taxonomy. React and Ink are required peer dependencies.

## Features

- **Reducer** — pure `(state, event) => state` fold over the `RunEvent` discriminated union; `reduceRenderStateAll` for one-shot replay
- **Dispatcher matrix** — `dispatch` and `dispatchInk` route a `DispatchInputs` to the matching `(RunShape, RunOutcome)` cell; `classifyRunShape` and `classifyOutcome` derive the coordinates
- **Ink components** — `StreamApp` and the supporting primitives (`ModuleHeader`, `TestRow`, `CoverageBlock`, `TrendLine`, `FailureSection`, etc.) for live `stream`-mode frames
- **PubSub channel** — `RunEventChannel` Effect tag and helpers (`accumulateUntilFinished`, `forEachRenderState`, `renderStateStream`) for live event transport
- **Synthesizers** — `synthesizeRunEvents` from live Vitest modules; `synthesizeFromAgentReport` from a stored `AgentReport`
- **Footer builder** — `buildFooter` assembles the L1 MCP-tool-pointer footer; `dominantClassification` picks the most actionable failure class

## Install

```bash
npm install @vitest-agent/ui
# or
pnpm add @vitest-agent/ui
```

React and Ink are required peers:

```bash
npm install react ink
```

## Quick start

```ts
import { reduceRenderStateAll } from "@vitest-agent/ui";
import { dispatch } from "@vitest-agent/ui";

const state = reduceRenderStateAll(events);
// state is a fully reduced RenderState

const agentString = dispatch(buildDispatchInputs(state, input), opts);
// agentString is the markdown-flavored final-frame string for the run
```

## Documentation

Package reference at [vitest-agent.dev/ui](https://vitest-agent.dev/ui).

## License

[MIT](LICENSE)
