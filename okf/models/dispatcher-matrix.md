---
type: DataModel
title: Dispatcher Matrix
description: "The 4 run-shapes x 3 outcome-classes cell table that selects console output: the classify step, the agent table at the ui root and the Ink table behind @vitest-agent/ui/ink, the footer, and what a new shape or outcome must add."
resource: ../../packages/ui/src/dispatcher
status: draft
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: 50ff718843b0818eb1d4ca43ec759d734bb0335fd5027d73aa276e248389ca7e
---

# Dispatcher Matrix

## What this covers

`dispatcherTable` (`packages/ui/src/dispatcher/dispatch.ts`) is a total
4×3 lookup table — every `RunShape` × `RunOutcome` pair maps to exactly one
cell, with no fallback and no default case[^dispatch]. A maintainer changing
either axis, or adding a twelfth-plus cell, has to keep this table total or
`dispatch` will throw on the missing combination at runtime —
there is no compile-time exhaustiveness check on this table the way the
`RunEvent` reducer has, so completeness rests entirely on the routing test.
Rationale for why the matrix is shaped this way (rather than one generic
renderer with conditionals) is recorded in
[Decision 78](../decisions/78-ink-half-behind-a-ui-subpath-and-lazy-reporter-views.md),
which superseded the original
[Shape-Tailored Dispatcher Matrix](../decisions/41-shape-tailored-dispatcher-matrix.md)
when the Ink half moved behind a subpath.

## The two classified axes

`classifyRunShape(state, projects)` and `classifyOutcome(state)`
(`packages/ui/src/dispatcher/classify.ts`) are pure functions of a
fully-reduced `RenderState`, run once at end-of-run (or once on
`RunFinished` in Ink mode, then reused for the rest of the run — a mid-run
shape change would be jarring)[^classify].

**`RunShape`** — four values, decided by these rules top-to-bottom:

1. `workspace` — `projects.length > 1`.
2. `single-project` — `state.collectedModules` is known and greater than
   one. Checked before the `modules` map, because a report replay reduces
   only the failing modules into that map, so a project run with one
   failing file would otherwise read as `single-file`.
3. `single-test` — exactly one module with exactly one test.
4. `single-file` — exactly one module with more than one test.
5. `single-project` — otherwise (one project, more than one module).

**`RunOutcome`** — three values, precedence top-to-bottom:

1. `some-fail` — `totals.failCount > 0`, OR `unhandledErrors.length > 0`
   (issue #240 — a process-level unhandled error must never hide behind an
   all-pass cell even with otherwise-clean counts), OR `totals.timeoutCount
   > 0` with `failCount === 0` (issue #224 — a timed-out test is not a
   pass).
2. `threshold-violation` — no failures/timeouts/unhandled errors, but
   `coverage.violations.length > 0` or a non-empty
   `coverage.globShortfalls` (a glob aggregate below its threshold fails
   Vitest's native check even when every per-file number passes). The
   `single-file`, `single-project`, and `workspace` threshold cells list
   the shortfalls under `Glob aggregates below threshold:` via the shared
   `formatCoverageSummaryLines` helper; `some-fail` cells carry no
   coverage section.
3. `all-pass` — otherwise.

**What breaks if this precedence is wrong:** because failures, timeouts,
and unhandled errors are all checked before coverage, a run with one
failing test and a coverage gap always routes to a `some-fail` cell, never
`threshold-violation` — the threshold cell is reserved for a test suite
that is otherwise clean. Reordering these checks would route a genuinely
broken run into the threshold-violation copy, which talks about coverage
policy and says nothing about the failing test.

## The 12 cells

`packages/ui/src/dispatcher/cells/` holds one file per `(shape, outcome)`
pair — `single-test-pass.ts`, `single-test-fail.ts`,
`single-test-threshold.ts`, and the equivalent triad for `single-file`,
`single-project`, and `workspace`. Each exports a `Cell`
(`packages/ui/src/dispatcher/cell-types.ts`), which is the agent half
only: `{ agent: AgentCellFn }`, a pure `(inputs, opts) => string` rendered
once at end-of-run[^cell-types]. None of these files imports React or Ink.

The Ink half is a second table. `inkDispatcherTable`
(`packages/ui/src/ink/dispatch-ink.ts`, exported from the
`@vitest-agent/ui/ink` subpath) has the same `RunShape × RunOutcome` keys
and holds an `InkCellFn` (`(inputs, opts) => ReactElement`) or `undefined`
per pair[^ink-dispatch]. Every defined Ink cell is derived from the matching
agent cell: it paints that cell's agent string as Ink `<Text>` rows, so
the two tables cannot disagree about what a pair renders. An `undefined`
entry means no Ink half; `dispatchInk` returns `null` and the caller falls
back to the agent string. `single-test ×
threshold-violation` is the one documented no-op cell — a single-test run
against a coverage threshold is not a meaningful combination in practice,
and its `agent` half returns the empty string rather than manufacturing
copy for a case that does not occur.

Cells receive `DispatchInputs` (`state`, `shape`, `outcome`, `projects`,
`trend`, `belowTarget`, `runCommand`) and `CellOptions` (`noColor`, `osc8`)
from `packages/sdk/src/contracts/dispatcher.ts` and never re-derive shape,
outcome, per-project aggregates, trend, or below-target file listings —
those are computed once by the plugin's `buildDispatchInputs` before
`dispatch` is called, specifically so twelve cells do not each reimplement
the same aggregation logic with twelve chances to disagree. **What breaks
if a cell reaches past its inputs:** a cell that calls into the kit or the
environment directly instead of reading `DispatchInputs`/`CellOptions`
breaks the purity `dispatch()`'s snapshot tests rely on (byte-identical
output for byte-identical input) and reintroduces the per-cell
divergence risk `buildDispatchInputs` exists to prevent.

## The classify step feeding the table

`dispatch(inputs, opts)` (`packages/ui/src/dispatcher/dispatch.ts`) and
`dispatchInk(inputs, opts)` (`packages/ui/src/ink/dispatch-ink.ts`) both do
the same two things: look up the matched cell in their own table
(`dispatcherTable` or `inkDispatcherTable`), invoke it, then append the scoped-coverage note
(`scopedCoverageNoteFor`) when `inputs.state.coverage.scoped === true`. That
note — "Coverage thresholds skipped: partial run (N of M test files)" — is
appended by the dispatcher itself, once, rather than by any individual cell,
so every shape and outcome gets the same explanation for why a subset run's
coverage thresholds are not meaningful (issue #160 gap 1). `dispatchInk`
wraps the cell's element and the note in a `Box`/`Text` pair built via
`createElement` rather than JSX, because `dispatch-ink.ts` is a `.ts`
module. It reuses the root's `scopedCoverageNoteFor`, so the note text has
one source.

After the scoped-coverage note, both entry points append the stray-output
note (`strayOutputNoteFor`, from `dispatch.ts`) when
`inputs.state.strayOutput` is set: the sdk's `formatStrayOutputNote`,
naming how many lines the run's test processes wrote straight to the
terminal, the streams, and the fix, plus up to three samples. Like the
scoped note it is appended once by the dispatcher, never by a cell, so all
twelve cells carry it without knowing about it. `dispatchInk` sets it off
with a one-row top margin. See [Decision
79](../decisions/79-capture-stray-output-at-vitest-logger-streams.md).

## The footer

`buildFooter(inputs)` (`packages/ui/src/dispatcher/footer.ts`) is a
separate pure function cells call directly (it is not wired into
`dispatch` or `dispatchInk` automatically) to append zero, one, or two
trailing lines pointing the agent at the most relevant `vitest-agent-mcp`
tool for its next action[^footer]:

| Cell outcome class | Footer pointer |
| --- | --- |
| all-pass with a non-empty `belowTarget` | `Use \`file_coverage\` to find uncovered functions.` |
| some-fail, dominant classification `new-failure` or `persistent` | `Use \`test_errors\` for failure detail; \`failure_signature_get\` to check known patterns.` |
| some-fail, dominant classification `flaky` | `Use \`failure_signature_get\` to confirm the flakiness signature.` |
| threshold-violation | `Use \`test_coverage\` for the workspace coverage breakdown.` |

`dominantClassification(state)` picks the single most actionable
classification present across `state.failures`, in priority order
`new-failure` → `persistent` → `flaky` → `recovered` → `stable`, returning
`null` when the failure list is empty or every entry is unclassified. The
inline backtick formatting in the footer strings is emitted verbatim —
agents read the literal backtick characters as cues, not as markdown to be
rendered.

## The synthesizers that feed cells

Two functions in `packages/ui/src/synthesize.ts` are the two ways a
`RunEvent` stream — and therefore eventually a `DispatchInputs` — gets
built: `synthesizeRunEvents` reads live Vitest module data during a run
(duck-typed `VitestTestModule` shapes), and `synthesizeFromAgentReport`
reads a persisted `AgentReport` for CLI replay. They are not
interchangeable: the live path carries per-test detail a persisted report
flattens away, so a report-replayed run can only ever synthesize events for
*failing* modules — this is why `RenderState.collectedModules` exists
(folded from `RunFinished.collectedModules`) rather than deriving an
all-passed module count from `moduleOrder.length`, which would undercount a
green replayed run to zero.

## What a new shape or outcome must add

Adding a fifth `RunShape` or a fourth `RunOutcome` value means: extending
the type in `packages/sdk/src/contracts/dispatcher.ts`, updating
`classifyRunShape`/`classifyOutcome`'s branches, writing three (or four)
new cell files under `dispatcher/cells/`, adding every new combination to
`dispatcherTable` and to `inkDispatcherTable` (an `undefined` entry when the
new cell has no live layout), and updating `buildFooter`'s table if the new axis value
needs its own pointer. None of this is compiler-enforced the way the
`RunEvent` reducer is — `dispatcherTable`'s type
(`Readonly<Record<RunShape, Readonly<Record<RunOutcome, Cell>>>>`) does
force every cell of the *current* matrix to be present, so extending either
union and forgetting to extend the table fails to typecheck; what is not
enforced is remembering to add the new axis value to `classify.ts` in the
first place, or to give the new cell a footer entry.

## The test that pins full coverage

`packages/ui/__test__/dispatch.test.ts`'s `"dispatcherTable covers every
shape × outcome pair"` test iterates the full `RunShape` × `RunOutcome`
cross product and asserts `dispatcherTable[shape][outcome]` is defined with
a callable `agent` function for every one of the 12 combinations, plus a
parallel per-pair test asserting each specific cell import is the one
actually wired into the table[^dispatch-test]. **What breaks if a cell goes
missing:** because `dispatcherTable`'s object-literal type already forces
every current combination to exist at compile time, this test's practical
value is catching the case where a *refactor* silently rewires two cells to
the same slot (the identity check `toBe(expected)`, not just
`toBeDefined()`) — a typo that assigns `renderSingleFileFail` into the
`single-project` row would still typecheck but would fail this test
immediately.

[^dispatch]: `../../packages/ui/src/dispatcher/dispatch.ts:40`
[^classify]: `../../packages/ui/src/dispatcher/classify.ts:34` (`classifyRunShape`), `../../packages/ui/src/dispatcher/classify.ts:75` (`classifyOutcome`)
[^cell-types]: `../../packages/ui/src/dispatcher/cell-types.ts:28`
[^ink-dispatch]: `../../packages/ui/src/ink/dispatch-ink.ts:45` (`inkDispatcherTable`), `../../packages/ui/src/ink/dispatch-ink.ts:79` (`dispatchInk`)
[^footer]: `../../packages/ui/src/dispatcher/footer.ts:64`
[^dispatch-test]: `../../packages/ui/__test__/dispatch.test.ts:59`
