import type { Executor } from "@vitest-agent/sdk";

/**
 * Values of `VITEST_AGENT_COVERAGE_DIR_ISOLATION` that opt out of the
 * per-process coverage directory rewrite.
 */
const OPT_OUT_VALUES = new Set(["off", "0", "false"]);

/**
 * Input signals used to decide whether a Vitest run's
 * `coverage.reportsDirectory` should be rewritten to a per-process
 * directory (issue #194 remaining scope).
 *
 * @public
 */
export interface ResolveCoverageDirIsolationInput {
	/** The detected executor for this run. */
	readonly executor: Executor;
	/** Vitest's native `coverage.enabled` resolution for this run. */
	readonly coverageEnabled: boolean;
	/** The environment to read the two override variables from. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** The configured `coverage.reportsDirectory` value, for reference/logging. */
	readonly configured: string | undefined;
}

/**
 * Decision returned by {@link resolveCoverageDirIsolation}.
 *
 * - `"keep"` — leave the configured `reportsDirectory` untouched (human/ci
 *   executors, coverage disabled, or the `VITEST_AGENT_COVERAGE_DIR_ISOLATION`
 *   opt-out).
 * - `"explicit"` — use `dir` verbatim (the `VITEST_AGENT_COVERAGE_DIR`
 *   override), no mkdtemp, no cleanup.
 * - `"isolate"` — rewrite to a fresh per-process `mkdtemp` directory; the
 *   caller is responsible for creating and cleaning it up.
 *
 * @public
 */
export type CoverageDirIsolationDecision =
	| { readonly kind: "keep" }
	| { readonly kind: "isolate" }
	| { readonly kind: "explicit"; readonly dir: string };

/**
 * Pure decision function: should this Vitest run's `coverage.reportsDirectory`
 * be isolated to a per-process temp directory?
 *
 * @remarks
 * Two concurrent plain-CLI `vitest run` invocations in one checkout share
 * `coverage.reportsDirectory` by default; the v8 provider's `clean: true`
 * default `rm -rf`s that directory at run start, so one run can delete the
 * other's `.tmp` files mid-run (issue #194). The MCP `run_tests` path
 * already isolates via `makeCoverageDirOverride()`; this function drives
 * the equivalent decision for the plain-CLI (`AgentPlugin.configureVitest`)
 * path.
 *
 * Only the `agent` executor is ever isolated — a human's `./coverage`
 * artifacts, and CI's configured directory, are never relocated.
 *
 * @public
 */
export function resolveCoverageDirIsolation(input: ResolveCoverageDirIsolationInput): CoverageDirIsolationDecision {
	const { executor, coverageEnabled, env } = input;

	if (!coverageEnabled) return { kind: "keep" };
	if (executor !== "agent") return { kind: "keep" };

	const isolationOverride = env.VITEST_AGENT_COVERAGE_DIR_ISOLATION;
	if (isolationOverride !== undefined && OPT_OUT_VALUES.has(isolationOverride)) {
		return { kind: "keep" };
	}

	const explicitDir = env.VITEST_AGENT_COVERAGE_DIR;
	if (explicitDir !== undefined && explicitDir.length > 0) {
		return { kind: "explicit", dir: explicitDir };
	}

	return { kind: "isolate" };
}
