/**
 * Input signals used to decide whether a Vitest run only exercised a
 * subset of the project's test files.
 *
 * @public
 */
export interface IsPartialRunInput {
	/** Vitest's `filenamePattern` for this run, when set by an explicit filter. */
	readonly filenamePattern: ReadonlyArray<string> | undefined;
	/** Number of test specifications that actually started for this run. */
	readonly startedSpecCount: number;
	/** Total number of test specifications discoverable for the same project set. */
	readonly totalSpecCount: number;
	/**
	 * `AgentReporter`'s construction-time `projectFilter` option, when set —
	 * NOT the CLI `--project` flag. `plugin.ts` never passes this when
	 * constructing `AgentReporter`, so in the production plugin path it is
	 * always `undefined`; a user's `--project` run is instead caught by the
	 * spec-count signal below (fewer specs started than exist in total).
	 * This field is only ever set by a caller constructing `AgentReporter`
	 * directly (e.g. a test, or a non-plugin embedding).
	 */
	readonly projectFilter: string | undefined;
}

/**
 * Pure decision function: was this Vitest run scoped to a subset of the
 * project's test files?
 *
 * @remarks
 * A run is partial when any of the following holds:
 * - Vitest's `filenamePattern` was set (a non-empty array) for this run.
 * - Fewer specifications started than exist in total for the same project set.
 * - An explicit `--project` filter was supplied.
 *
 * Any of these makes coverage's whole-project denominator meaningless for
 * threshold enforcement (issue #160).
 *
 * @public
 */
export function isPartialRun(input: IsPartialRunInput): boolean {
	const { filenamePattern, startedSpecCount, totalSpecCount, projectFilter } = input;
	if (filenamePattern !== undefined && filenamePattern.length > 0) return true;
	if (startedSpecCount < totalSpecCount) return true;
	if (projectFilter !== undefined) return true;
	return false;
}
