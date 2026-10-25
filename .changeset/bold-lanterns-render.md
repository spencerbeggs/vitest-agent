---
"@vitest-agent/reporter": major
---

## Breaking Changes

The `resolveCellOptions` export is removed. Use the new `renderAgentStringForReport(report, options?)` together with `ReportRenderOptions` / `HumanReportRenderOptions` to control rendering; file links are now handled internally.

## Features

* Agent and human output render suggested actions (an Actions trailer) and console leaks
* Human TTY output gets clickable file links through the kit's `CliLinks`; agent output never does
* The stray-output note appears in the GitHub step summary, `summary.md` and the `::group::` log block

## Bug Fixes

* The GitHub log block counts timed-out tests separately instead of lumping them in with failures
