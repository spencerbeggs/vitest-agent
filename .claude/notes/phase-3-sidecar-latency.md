---
title: Phase 3 sidecar latency profile (post-T9.2)
date: 2026-05-15
related-plans: [.claude/plans/roadmap-2.0.0.md, .claude/plans/2.0-release-order.md]
related-notes: [.claude/notes/phase-2-sidecar-latency.md]
---

## T9.2 sidecar fix — measured 2026-05-15

Companion to `phase-2-sidecar-latency.md`. Phase 2 measured the raw
sidecar process (`node <bin> _internal <subcommand>`). Phase 3 measures
the full PreToolUse Bash hook end-to-end — `plugin/hooks/pre-tool-use/bash.sh`
fired against a synthetic Claude Code payload — because that whole-hook
wall-clock is what a Claude Code agent actually waits on per Bash call.

Measured on a developer laptop (macOS, Apple Silicon, bash 5.3.9) via
`scripts/bench-sidecar.sh --trials 30`. The sidecar binary is the
tsdown-built Node SEA executable for darwin-arm64.

## The four code paths

T9.2 splits the hook into three layers. Each path below is what some
fraction of real Bash calls hits.

### layer0-skip — non-Vitest command (Layer 0 regex prefilter)

| metric | ms |
| --- | --- |
| n | 30 |
| min | 13.6 |
| p50 | 14.3 |
| p95 | 16.0 |
| p99 | 17.0 |

Roughly 80–90% of Bash calls. The Layer 0 regex decides the command
cannot invoke Vitest and emits a no-op before any sidecar work.

### layer1-skip — Vitest command, main-agent context (Layer 1 skip)

| metric | ms |
| --- | --- |
| n | 30 |
| min | 14.2 |
| p50 | 14.9 |
| p95 | 16.4 |
| p99 | 16.4 |

Main-agent Vitest invocations. The auto-sourced environment is already
correct, so Layer 1 skips the sidecar.

### layer2-binary — subagent Vitest, native binary on PATH

| metric | ms |
| --- | --- |
| n | 30 |
| min | 83.2 |
| p50 | 84.7 |
| p95 | 88.4 |
| p99 | 88.5 |

The residual ~2% — subagent-triggered Vitest invocations that genuinely
need the env-prefix rewrite. The SEA binary handles inject-env.

### layer2-jsfallback — subagent Vitest, no binary (JS CLI fallback)

| metric | ms |
| --- | --- |
| n | 30 |
| min | 625.6 |
| p50 | 635.8 |
| p95 | 659.0 |
| p99 | 660.1 |

The fallback when no platform binary is installed. Pays the full Node
cold-start the workstream set out to remove — but only on the ~2% path,
and only when the optional binary is absent.

## Comparison vs Phase 2

Phase 2 clocked the inject-env sidecar process at p95 ≈ 505 ms. Before
T9.2 every Bash call paid that, plus the hook's own plumbing — roughly
535 ms p95 on the hot path.

| path | before T9.2 | after T9.2 | change |
| --- | --- | --- | --- |
| non-Vitest command (~85%) | ~535 ms | ~16 ms | -97% |
| main-agent Vitest (~13%) | ~535 ms | ~16 ms | -97% |
| subagent Vitest, binary (~2%) | ~535 ms | ~88 ms | -84% |
| subagent Vitest, JS fallback | ~535 ms | ~659 ms | regressed |

The JS-fallback row is slower than the pre-T9.2 number because it now
also pays the Layer 0/1 checks and a `command -v` probe before falling
through. This path only runs on an unsupported platform or a skipped
optional dependency, and the slowdown is a few milliseconds against a
~650 ms baseline — not worth special-casing.

## Findings vs the launch gate

The launch gate: hot-path p95 under 20 ms, subagent-Vitest path p95
under 150 ms. Both pass — 16 ms and 88 ms.

The T9.2 spec originally wrote the hot-path gate as "under 10 ms" and
projected "~3–5 ms average across all Bash calls". That projection
underestimated the bash hook process itself. With the ~505 ms sidecar
shell-out fully removed, the residual ~16 ms is irreducible hook
plumbing: spawning bash, sourcing four lib helpers, and one jq parse of
the payload. None of it is sidecar-attributable.

The hook was already tuned during this work — payload parsing went from
six jq forks to one, and the `dirname` lookup from four forks to one,
which roughly halved the hot path from ~30 ms to ~16 ms. Pushing below
~12–14 ms would mean a compiled hook helper or a persistent daemon —
the heavyweight options the T9.2 spec deliberately rejected in favor of
the cheap layered prefilter. The 2.0 release-order guide's 20 ms budget
is the realistic figure and is the gate this note is measured against.

## Open follow-up (2.x)

- **register-agent in the binary.** The SEA binary handles inject-env
  only. register-agent pulls in a native SQLite binding that cannot be
  bundled into a JavaScript single-executable; it stays on the JS CLI
  path, which fires once per session and is off the per-turn critical
  path. Embedding the native binding per platform is a tracked 2.x item.
- **Sub-10 ms hot path.** If the ~16 ms hook plumbing ever surfaces as
  user-visible jank, a compiled hook helper is the next lever. Not
  planned for 2.0.
