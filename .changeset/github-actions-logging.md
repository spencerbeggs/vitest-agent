---
"@vitest-agent/plugin": minor
"@vitest-agent/reporter": minor
---

## Features

### Guaranteed GitHub Actions reporter

Under GitHub Actions, `AgentPlugin` now explicitly ensures Vitest's built-in `github-actions` reporter is present in the reporter chain. Vitest only auto-appends that reporter when `reporters` resolves empty, so it silently dropped out as soon as any reporter was configured — including the plugin's own. Failure annotations now reach the run summary reliably instead of depending on config shape.

### Collapsed run summary in the Actions log

`DefaultVitestAgentReporter` now emits a compact `::group::vitest-agent` block at the end of a run when GitHub Actions is detected. It reports per-project pass/fail/skip counts, how many files sit below their coverage target, any non-stable test classifications (`flaky`, `new-failure`, `persistent`, `recovered`), and the database path results were persisted to.

The block is collapsed by default, and Vitest's own reporters are left alone: the `ci` console slot still defaults to `passthrough`, so the `default` reporter continues to own the job-log body. The two are complements — `github-actions` emits annotations only, and carries no counts or summary of its own.
