/**
 * Sidecar `inject-env` subcommand.
 *
 * Thin re-export of the `injectEnv` implementation from
 * `vitest-agent-cli`. The CLI package is the single source of truth
 * for the Vitest-detection / command-rewrite logic; the sidecar binary
 * exists only to avoid the Node cold-start cost of invoking that logic
 * through the full `@effect/cli` entry point.
 *
 * @packageDocumentation
 */

export { type InjectEnvInput, injectEnv } from "vitest-agent-cli";
