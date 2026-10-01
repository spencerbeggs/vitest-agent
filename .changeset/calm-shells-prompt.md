---
"@vitest-agent/cli": major
---

## Features

### Audience flags

Global `--audience <human|agent|ci>` plus the `--human`, `--agent`, and `--ci` shorthands, and the `VITEST_AGENT_AUDIENCE` environment variable, select who the output is for. Agents and CI get NDJSON logs; humans get plain logs. `FORCE_COLOR` is honoured. `--human` re-enables interactive prompting inside an agent-detected shell.

## Breaking Changes

- `vitest-agent db reset` exit code `5` now means "not interactive": a non-TTY, `--agent`/`--ci`, or an agent-detected shell. Previously it meant only "stdout is not a TTY". Scripts that run in agent-detected shells and relied on the prompt should pass `--human` to force it.
- Ctrl-C at the `db reset` prompt exits `130`.

## Bug Fixes

- Unexpected failures print a stack trimmed to this package's own frames followed by a "Please report at" line, and no longer print a doubled `[FAIL]` marker.
