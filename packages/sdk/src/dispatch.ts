/**
 * @vitest-agent/sdk/dispatch
 *
 * Dedicated narrow entry point for the `@vitest-agent/sidecar` native
 * binary. Exports only the sidecar argv-dispatch core: {@link dispatch}
 * (the hand-rolled, dependency-free dispatcher), {@link injectEnv} (the
 * `inject-env` hot-path implementation), and {@link exitCodeForTag} (the
 * tagged-error → exit-code mapping).
 *
 * This entry exists separately from the sdk main barrel on purpose. The
 * SEA binary's whole reason to exist is small + fast; importing from
 * the main barrel would force the SEA bundler to tree-shake away
 * Effect, the SQLite data layer, the migrations, and every service.
 * A dedicated entry guarantees the minimal reachable graph — `dispatch`
 * → `injectEnv` → the pure `match-vitest-command` helpers, plus the
 * pure `exitCodeForTag` switch.
 *
 * The four `@vitest-agent/sidecar-<platform>` child packages import
 * `dispatch` from here; `@vitest-agent/cli` imports `injectEnv` /
 * `exitCodeForTag` from here for its own `agent inject-env` JS-fallback
 * subcommand.
 *
 * @packageDocumentation
 */
export { exitCodeForTag } from "./exit-code-for-tag.js";
export { type InjectEnvInput, injectEnv } from "./internal-inject-env.js";
export { type DispatchResult, dispatch } from "./sidecar-dispatch.js";
