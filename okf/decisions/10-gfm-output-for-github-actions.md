---
type: Decision
title: GFM Output for GitHub Actions
description: The plugin auto-detects GitHub Actions and always writes a GFM step-summary block, including a per-project totals table, because Vitest's own job summary is disabled.
status: stable
tags:
  - architecture
  - ci
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 411e2143ed4911121dc25c46e35ba38fe5e82dac7b63cad85c6e88ef74c76684
sources:
  - id: plugin-plugin-ts
    resource: ../../packages/plugin/src/plugin.ts
  - id: plugin-ensure-github-reporter
    resource: ../../packages/plugin/src/utils/ensure-github-reporter.ts
  - id: plugin-build-reporter-kit
    resource: ../../packages/plugin/src/utils/build-reporter-kit.ts
  - id: reporter-default-reporter
    resource: ../../packages/reporter/src/defaultReporter.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# GFM Output for GitHub Actions

## Context

A CI run and a local terminal run need the same underlying report data,
just rendered for different readers: a human at a terminal, or a GitHub
Actions job summary reader who never sees stdout at all. Building a
separate reporter class for the CI case would duplicate the classification,
coverage, and trend logic the terminal path already has; conditional
formatting over the same data is simpler.

**Delta from the retired premise.** The step-summary block was originally
written without a totals table, on the theory that Vitest's own
`github-actions` reporter already wrote pass/fail/skip counts to
`$GITHUB_STEP_SUMMARY`. That premise no longer holds: `configureVitest`
now disables that reporter's markdown job summary under CI GitHub
Actions, so a run that produced no classification, coverage, or trend
content wrote nothing to the step summary at all — a passing run looked
exactly like a run where the plugin never ran.

## Decision

`AgentPlugin` auto-detects `GITHUB_ACTIONS=true` and derives the step
summary on/off state from that plus the resolved console mode — there is
no user-facing `githubSummary` option to set directly. Inside
`configureVitest`, `env === "ci-github" && consoleMode !== "silent"`
computes `githubActions`, which flows into `buildReporterKit` as the
`githubSummary` field and from there onto `ResolvedReporterConfig`; the
one lever a consumer has is setting the matching `console.ci` slot to
`"silent"`, which suppresses both the step summary and the GitHub Actions
`::error::` annotations together.[^plugin-plugin-ts][^plugin-build-reporter-kit]

Under the same `env === "ci-github" && consoleMode !== "silent"`
condition, `ensureGithubActionsReporter` normalizes Vitest's own
`reporters` array so any `"github-actions"` entry — whether Vitest 5
auto-seeded it via `configDefaults.reporters` or the user configured it
explicitly — has `jobSummary.enabled` forced to `false`, unless the user
explicitly opted into `jobSummary.enabled: true`, in which case a
`ConfigValidation` rule warns about the resulting double-write instead of
silently overriding it.[^plugin-ensure-github-reporter] This is why the
plugin's own block became the only step-summary content a CI reader gets.

`buildSummaryMarkdown` always returns a non-empty markdown body: a
`## vitest-agent` heading, then `renderTotalsSection` — a
`### Totals` table with one row per project (`Project | Passed | Failed |
Timed out | Skipped | Duration`), plus a `**Total**` row only when there
is more than one project — followed by whichever of the classification,
coverage, and trend sections have content.[^reporter-default-reporter]
Every row in the totals table comes from `summarizeProject`, the same
projection the console output renders from, so the CI table cannot
disagree with what a terminal shows for the same run: a timed-out test
reports as its own `Timed out` column entry in both places rather than
inflating `Failed` in one and not the other. The same markdown is what
the reporter writes to the `summary.md` report file, so the step summary
and the persisted file are never two independently-maintained renderings
of the same run.

The step-summary path is otherwise independent of `consoleMode`: it
defaults on under GitHub Actions whenever the resolved console mode is
not `silent`, regardless of which non-silent mode is selected, and the
same `console.ci: "silent"` override that suppresses it also suppresses
Vitest's own annotations reporter injection.

## Alternatives rejected

**A dedicated CI reporter class parallel to the terminal one.** Would
duplicate the classification/coverage/trend computation the terminal
path already performs on the same `AgentReport[]`, and would risk the
CI table and the terminal output disagreeing on a run's outcome — exactly
the discrepancy `summarizeProject` as a single shared projection exists
to prevent.

**Returning `null` (no output) on an all-green run with nothing to
report.** This is the retired behavior described above: correct only
under the premise that Vitest's own reporter already wrote the counts.
Once that reporter's job summary is disabled, a `null` return left a
passing CI run with a blank step summary, indistinguishable from the
plugin never having run at all.

**A user-facing `githubSummary` boolean option.** Considered and
rejected in favor of full auto-derivation from environment plus console
mode: a separate toggle would let a consumer's CI config and their
`console.ci` setting disagree, producing exactly the ambiguous states
(step summary on but console silent, or vice versa) the current design
collapses into one `console.ci` lever.

## Consequences

A CI reader always sees at least the totals table, on every run,
green or red — the step summary is never empty when the plugin
participated in the run. The plugin's ownership of `$GITHUB_STEP_SUMMARY`
under CI means it must actively suppress Vitest's own job-summary write
rather than merely coexist with it, which is the coupling
`ensureGithubActionsReporter` and the `GITHUB_JOB_SUMMARY_COLLISION`
`ConfigValidation` warning exist to manage — a future Vitest version that
changes its own default `reporters` seeding or `jobSummary` default would
need that normalization logic revisited. See
[Interface: report-files](../interfaces/report-files.md) for the
`summary.md` contract this same markdown feeds, and
[Module: reporter](../modules/reporter.md) for where
`buildSummaryMarkdown` and `summarizeProject` live.

[^plugin-plugin-ts]: `../../packages/plugin/src/plugin.ts` (reporter normalization gate), `../../packages/plugin/src/plugin.ts` (`githubActions` derivation)
[^plugin-build-reporter-kit]: `../../packages/plugin/src/utils/build-reporter-kit.ts`
[^plugin-ensure-github-reporter]: `../../packages/plugin/src/utils/ensure-github-reporter.ts`
[^reporter-default-reporter]: `../../packages/reporter/src/defaultReporter.ts` (`renderTotalsSection`), `../../packages/reporter/src/defaultReporter.ts` (`buildSummaryMarkdown`)
