/**
 * `vitest-agent-sidecar` package entry.
 *
 * The parent package's published JS bundle, for programmatic
 * consumers. The sidecar's runtime artifacts are the
 * `bin/launcher.js` resolver shim (the package `bin`) and the five
 * `vitest-agent-sidecar-<platform>` SEA binaries (optional
 * dependencies). This barrel re-exports the sidecar-facing surface
 * from `vitest-agent-cli`, which owns the implementation:
 *
 *   - {@link dispatch} — the argv dispatcher each platform binary runs.
 *   - {@link injectEnv} — the pure command-rewrite hot path.
 *
 * Single-sourcing the dispatcher in `vitest-agent-cli` keeps the five
 * child packages on a clean package import rather than a cross-package
 * filesystem path. This package stays a valid, resolvable rslib
 * package so consumers can declare it as a `workspace:*` dependency —
 * notably `vitest-agent-plugin`, whose `build:prod` workspace
 * resolution depends on rslib emitting a transformed
 * `dist/dev/package.json` here.
 *
 * @packageDocumentation
 */

export { type DispatchResult, type InjectEnvInput, dispatch, injectEnv } from "vitest-agent-cli";
