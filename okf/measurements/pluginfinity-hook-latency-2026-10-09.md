---
type: Measurement
title: pluginfinity hook latency, 2026-10-09
description: PreToolUse Bash hook latency after the pluginfinity migration, measured with scripts/bench-sidecar.sh on macOS arm64; sourcing the hook library adds about 50 ms per hook, so the Layer 0/1 skip path misses its 20 ms gate at 63.5 ms p95 and the JS fallback reaches 492 ms p95.
justifies: ../decisions/80-build-the-agent-plugin-from-one-pluginfinity-source.md
tags: [performance]
stale_after: 2027-01-07T00:00:00Z
status: draft
sources:
  - id: bench-script
    resource: ../../scripts/bench-sidecar.sh
  - id: bash-hook
    resource: ../../plugin/hooks/pre-tool-use/bash.sh
  - id: pr-585
    resource: https://github.com/spencerbeggs/vitest-agent/pull/585
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: df95e0091363503468d913412e59616c52433237af380aacce8a354ca7e65f58
---

# pluginfinity hook latency, 2026-10-09

## Inputs

The hook under test is the PreToolUse Bash hook
`plugin/builds/claude/hooks/pre-tool-use/bash.sh`, after the move to
pluginfinity's hook library ([Decision
80](../decisions/80-build-the-agent-plugin-from-one-pluginfinity-source.md)).[^bash-hook]
Its three-layer pipeline is unchanged from [Decision
42](../decisions/42-three-layer-sidecar-performance-fix.md). Each run now
sources pluginfinity's generated `hook.sh` before the hook body, and that
library forks `jq`, `mktemp`, and `cat` at load time. The host was macOS
arm64. The native sidecar binary was not built, so the Layer 2 number is
the JS CLI fallback.

## Method

`scripts/bench-sidecar.sh --trials 10`.[^bench-script] The harness fires the
built hook against synthetic PreToolUse payloads, with the session values
written to a scratch pluginfinity state directory. It times each whole
`bash` invocation and reports p95 per scenario against two gates: under
20 ms for the skip paths and under 150 ms for the live Layer 2
path.[^pr-585]

## Numbers

| Path | Before the migration | 2026-10-09 (p95) | Gate |
| --- | --- | --- | --- |
| Layer 0/1 skip | about 16 ms | 63.5 ms | under 20 ms |
| JS CLI fallback (Layer 2) | not recorded | 492 ms | under 150 ms |

The "before" figure comes from the PR's summary, not from a preserved
harness table. The earlier [sidecar hook latency
measurement](sidecar-hook-latency.md) recorded only ratios. Both gates
fail. About 50 ms of every hook's cost is library load, paid before the
hook body runs. A Bash call fires three hooks.

## What this ruled in and out

**Ruled in:** the regression comes from the library's load cost, not from
the three-layer design. Layer 0 and Layer 1 still skip all sidecar work;
they just start about 50 ms later. **Ruled out:** reading this as a reason
to revert Decision 42's pipeline. The fix is a cheaper library load,
tracked upstream as spencerbeggs/pluginfinity issue 26. Re-run the harness
once that lands, and again with the native sidecar built. Neither run
exists yet.

[^bash-hook]: `../../plugin/hooks/pre-tool-use/bash.sh`
[^bench-script]: `../../scripts/bench-sidecar.sh`
[^pr-585]: <https://github.com/spencerbeggs/vitest-agent/pull/585>
