---
type: Decision
status: stable
title: Fail Open on Non-Default Discovery via Lexical Config Detection
description: Why the test-location hook's classifier bails out to "no verdict" rather than deny when it cannot rule out a consumer's non-default DiscoverStrategy, and why that check is a lexical regex scan rather than a config load.
tags: [architecture, testing, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 8511bbc31fa6b7991695fa220ab71570079af33b422a02a13613f10fd8bff232
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Fail Open on Non-Default Discovery via Lexical Config Detection

## Context

`plugins/claude-code/hooks/pre-tool-use/test-location.sh` delegates to `vitest-agent agent check-test-path`, which classifies a test path with `classifyTestPath` — the same rule the default `DiscoverStrategy` generates its include globs from. That rule is only correct for workspaces that use the default strategy. A consumer who passes a custom `discoverStrategy` (including `discoverStrategy: false`), chains `AgentPlugin.discover().addProject(...)`, or subclasses `DefaultDiscoverStrategy` can legitimately collect tests from paths the default rule calls `invalid`, and the hook would deny a `Write` to such a path with confident, wrong advice. A denial is the strongest action the hook can take, so its false positives cost more than its false negatives.

## Decision

`check-test-path` (`packages/cli/src/commands/agent.ts`) refuses to render a verdict when it cannot rule out a non-default strategy. It locates the workspace's first `vitest.config.*`/`vitest.workspace.*`/`vite.config.*` candidate (`packages/cli/src/commands/agent.ts`), reads its source text via `readWorkspaceVitestConfigSource` (`packages/cli/src/commands/agent.ts`), and runs the pure `detectNonDefaultDiscoverStrategy(source)` from `@vitest-agent/sdk` (`packages/sdk/src/utils/detect-non-default-discover-strategy.ts`) over it: after a best-effort comment strip (`packages/sdk/src/utils/detect-non-default-discover-strategy.ts`), it looks for a `discoverStrategy:` option, a `.addProject(` call, or a class `extends DefaultDiscoverStrategy`/`implements DiscoverStrategy`. Any marker — or no readable config at all — exits 1 with no stdout (`packages/cli/src/commands/agent.ts`), and the hook's existing "CLI failed → `emit_noop`" path turns that into a silent allow. A missing or unreadable config is treated exactly like a detected marker: no verdict beats a confidently wrong one.

Two complements sit on the plugin side: the hook honours `VITEST_AGENT_TEST_LOCATION_HOOK=off|0|false` as a total opt-out, checked before stdin is read so no CLI is spawned (`plugins/claude-code/hooks/pre-tool-use/test-location.sh`); and the deny/advisory wording says "Under the default discovery layout …" and names the opt-out, so a consumer the detector misses still gets a truthful message and a way out.

## Alternatives rejected

Loading the consumer's actual Vitest config to determine the discovery strategy in force was rejected: the hook fires on every `Read`/`Write`/`Edit` of a test-shaped path — it is on the agent's hot path — and loading `vitest.config.ts` means a Vite/esbuild transform, resolving the consumer's plugins, and executing arbitrary user code on every keystroke-adjacent tool call. `check-test-path` would stop being a sub-second classification and start being a config boot. Making `classifyTestPath` itself strategy-aware was also rejected for the same reason: it would require the CLI to instantiate the consumer's strategy, the identical config-load problem. The honest scope of the check is "the default layout"; the fix makes the check say so and step aside when the default layout is not in force, rather than pretending to understand layouts it cannot see.

## Consequences

A regex scan of one file is bounded and side-effect-free, but imprecise: it is acceptable only because the detector's sole job is to decide whether to fail open. A marker that appears inside a string literal, or a comment the stripper missed, yields a false positive whose consequence is one skipped advisory — harmless. The direction the detector cannot afford to be wrong in — a real custom strategy it fails to see, which would still trigger the default deny path — is what the `VITEST_AGENT_TEST_LOCATION_HOOK` opt-out exists to cover. Every other exit-1 path in `check-test-path` (no containing workspace, a nested `package.json` boundary crossed, a non-discoverable directory segment, no classification) means exactly the same thing: no verdict rendered, so the hook must fail open.
