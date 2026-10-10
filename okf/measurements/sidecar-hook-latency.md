---
type: Measurement
title: Sidecar hook latency
description: A qualitative order-of-magnitude comparison of PreToolUse Bash hook latency across the three-layer sidecar fix's code paths, measured with scripts/bench-sidecar.sh.
justifies: ../decisions/42-three-layer-sidecar-performance-fix.md
tags: [performance]
stale_after: 2027-03-12T00:00:00Z
status: draft
sources:
  - id: bench-script
    resource: ../../scripts/bench-sidecar.sh
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 6563527f006605be800065a8ba7ef1c989981ea6f1b4f16546b7253a368c11c3
---

# Sidecar hook latency

These ratios predate the pluginfinity migration. Since then, sourcing the
pluginfinity hook library adds about 50 ms to every hook, and the skip path
no longer meets its 20 ms gate. See [pluginfinity hook latency,
2026-10-09](pluginfinity-hook-latency-2026-10-09.md) for the current
numbers.

## Inputs

The comparison is over the PreToolUse Bash hook's four code paths, as the
three-layer fix in [Decision 42](../decisions/42-three-layer-sidecar-performance-fix.md)
defines them:

- **`layer0-skip`** — a non-Vitest Bash command; the Layer 0 regex prefilter
  emits a no-op before any further work.
- **`layer1-skip`** — a Vitest command in a main-agent context; Layer 1
  compares `VITEST_AGENT_AGENT_ID` against `VITEST_AGENT_MAIN_AGENT_ID` and
  skips the sidecar because attribution is already correct.
- **`layer2-binary`** — a Vitest command in a subagent context, with the
  native `vitest-agent-sidecar` SEA binary on `PATH`.
- **`layer2-jsfallback`** — the same subagent case with no binary on `PATH`,
  so the JS CLI (`vitest-agent agent inject-env`) runs instead, paying full
  Node cold-start plus the `effect` / `effect/cli` module-graph
  load.

The **baseline** this fix replaced is the unconditional shell-out every Bash
call once paid: roughly 505 ms p95 of Node cold-start plus that module-graph
load, before any of the three layers existed.

## Method

`scripts/bench-sidecar.sh` is the harness[^bench-script]. It fires the real
PreToolUse Bash hook against synthetic Claude Code PreToolUse payloads built
with `jq`, under a scratch `HOME` so the synthetic session-env files never
touch a real `~/.claude` tree. The harness now targets the built
`plugin/builds/claude/hooks/pre-tool-use/bash.sh` and writes the session
values to a scratch pluginfinity state directory instead. For each of the four scenarios above it writes a synthetic
session-env file that models either a main-agent or a subagent actor
(`VITEST_AGENT_AGENT_ID` equal to or different from
`VITEST_AGENT_MAIN_AGENT_ID`), constructs the matching hook payload
(`git status` for the Layer-0 scenario, `pnpm test` for the rest), and runs
the hook `--trials` times (default 30) under bash's `EPOCHREALTIME`
microsecond wall clock, timing the whole `bash "$HOOK" <<<"$payload"`
invocation end to end. It reports min / mean / p50 / p95 / p99 / max per
scenario and checks two launch gates: the hot-path scenarios (`layer0-skip`,
`layer1-skip`) must land p95 under 20 ms, and whichever Layer-2 scenario is
live (binary if built, JS fallback otherwise) must land p95 under 150 ms.
The `layer2-binary` scenario is skipped entirely when no built SEA binary is
found at the expected per-platform `dist/npm/bin/` path, in which case the
report covers three scenarios rather than four.

## Numbers

This document records the qualitative ratio the repository's design
material carried forward rather than a captured table of min/mean/p50/p95:
the hot path (`layer0-skip` and `layer1-skip`, the large majority of real
Bash calls) is **roughly an order of magnitude faster** than the
unconditional JS shell-out baseline, and the `layer2-binary` path sits
**between** the hot-path numbers and the `layer2-jsfallback` path — faster
than a full JS cold-start but slower than the two skip layers, because it
still pays process-spawn plus one native-binary exec. The
`layer2-jsfallback` path remains at full Node cold-start and is the
unconditional-shell-out baseline reproduced on demand, gated by the harness's
150 ms p95 launch gate rather than the pre-fix 505 ms figure. No run of this
harness's actual output (a table of min/mean/p50/p95/p99/max per scenario,
on a specific host and Node version) is preserved in this repository as of
this writing; a re-run of `scripts/bench-sidecar.sh` on the target host would
produce it, since the script prints exactly that table and checks the two
launch gates automatically.

## What this ruled in and out

**Ruled in:** the three-layer prefilter-plus-binary design as a whole — the
two near-free bash-level skip layers (0 and 1) so the sidecar is bypassed
entirely for the large majority of calls, and a native SEA binary for the
residual slow path rather than a persistent daemon. **Ruled out:** a
long-running daemon, which would have removed the cold-start cost but added
a per-instance socket, a lifecycle to manage, and a coordination directory —
machinery the harness's own gate numbers show is unnecessary once Layers 0
and 1 already eliminate most of the traffic the daemon would have served.

[^bench-script]: `scripts/bench-sidecar.sh`
