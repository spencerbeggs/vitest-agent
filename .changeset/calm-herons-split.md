---
"@vitest-agent/ui": major
---

## Breaking Changes

The Ink half of the package moved to a new `@vitest-agent/ui/ink` subpath, so the root entry no longer loads React or Ink.

Moved to `@vitest-agent/ui/ink`: `StreamApp`, `CountColumns`, `CoverageBlock`, `FailureSection`, `FailuresSection`, `ModuleHeader`, `ProjectRow`, `StatusIcon`, `SuggestedActions`, `TagColumns`, `TestRow`, `TrendLine` (with their `*Props` types), `StatusIconKind`, `DURATION_CELL_WIDTH`, `tagUnion`, `dispatchInk` and `InkCellFn`.

The root `Cell` type lost its `ink` half. Use the new `inkDispatcherTable[shape][outcome]` from `@vitest-agent/ui/ink` instead; an entry is `undefined` for the one cell with no Ink half (`single-test` x `threshold-violation`).

`ink` and `react` are now optional peer dependencies, needed only when you import `@vitest-agent/ui/ink`.

## Features

Supports Ink 8.

Stray output is now reported. The stray-output note appears in `renderAgent`, `dispatch`, `dispatchInk` and the `StreamApp` live final frame, and the reducer folds `RunFinished.strayOutput` into the render state.
