---
"@vitest-agent/sdk": major
---

## Breaking Changes

File links now flow through a single optional `CellOptions.link` writer (typed by the new `FileLinkTarget`) instead of ad-hoc OSC 8 escapes inside the dispatcher.

Removed exports and fields:

* `CellOptions.noColor` and `CellOptions.osc8`
* `ReporterKit.stdOsc8`
* the `osc8` function and the `Osc8Options` type

Migration: renderers that emitted hyperlinks through `osc8` should supply a `link` writer on `CellOptions`; dropping `noColor` and `osc8` needs no replacement, since the link writer decides whether a link is emitted at all.

### Published run.json schema emits plain numbers

`schemas/5.0/run.json` no longer carries the `"Infinity"` / `"NaN"` string arms on numeric fields. Non-finite values now fail decode, so producers must send finite numbers. The new `FiniteNumber` schema backs this.

## Features

* `ProjectIdentitySourceError`, `ProjectIdentitySource` and `ProjectIdentityError` describe a project identity that could not be read from its config
* `formatConsoleLeaksNote` renders the console-leak note shared by every output surface
* `ReporterRenderInput.suggestedActions` is a new optional field, and `RunFinished` / `RenderState` gain an optional `consoleLeaks`
