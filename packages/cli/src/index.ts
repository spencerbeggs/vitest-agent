/**
 * @vitest-agent/cli
 *
 * On-demand CLI for vitest-agent. Reads cached test data and
 * reports status, overview, coverage, history, trends, and cache health.
 *
 * The default entry point is `bin.ts` (registered as the
 * `vitest-agent` bin); this barrel exposes the package version for
 * programmatic introspection.
 *
 * @packageDocumentation
 */

// The sidecar platform layer (`SidecarPlatformLive`), the hook-path
// resolver (`resolveHookPaths`) and the register/end-agent programs live
// in `@vitest-agent/engine` as of the #412 engine split; import them from
// there. This barrel no longer re-exports them.

// Side-effect-free and never imports `./main.js` — the process-owning
// assembled program — so a library consumer's import graph never pulls it in.
export { CURRENT_CLI_VERSION } from "./version.js";
