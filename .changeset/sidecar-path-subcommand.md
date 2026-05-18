---
"vitest-agent-cli": minor
---

## Features

### `vitest-agent agent sidecar-path`

A new subcommand prints the absolute path of the installed platform sidecar binary to stdout (exit 0), or exits non-zero when no platform binary is resolvable.

```bash
vitest-agent agent sidecar-path
# /path/to/node_modules/vitest-agent-sidecar-darwin-arm64/bin/vitest-agent-sidecar
```

The resolution delegates to `resolveSidecarBinaryPath()` from `vitest-agent-sidecar`. Hook scripts call this once per session to capture the path rather than performing a PATH lookup, which would always fail because pnpm and npm never hoist transitive optional-dependency bins into `node_modules/.bin/`.

`vitest-agent-sidecar` is now a runtime dependency of `vitest-agent-cli`.

## Maintenance

The unused `vitest-agent-ui` dependency is removed from `vitest-agent-cli` — the pre-2.0 `show` command that imported it was deleted in the T8 utility-only restructure.
