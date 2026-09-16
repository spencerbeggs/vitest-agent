/**
 * The subset of Vitest's CLI/programmatic run-scoping options that narrow
 * which tests execute for a run. Populated from the stashed Vitest
 * instance's `config.cliOptions` — the raw options object `startVitest`
 * captures verbatim (see `resolveConfig.ts`), which is also how MCP
 * `run_tests`' programmatic filters arrive (config-file settings do NOT
 * populate `cliOptions`, which is the correct semantics: a project's own
 * `vitest.config.ts` narrowing is not a "partial run" from the coverage
 * denominator's point of view).
 *
 * @public
 */
export interface CliScopeFilters {
	/** `--project` — a workspace-project name filter. */
	readonly project?: ReadonlyArray<string> | string | undefined;
	/** `--tags-filter` — a tag-expression filter. */
	readonly tagsFilter?: ReadonlyArray<string> | undefined;
	/** `--changed` — git-changed-file scoping; `true` or a ref string. */
	readonly changed?: boolean | string | undefined;
	/** `--related` — file(s) whose dependents should run. */
	readonly related?: ReadonlyArray<string> | string | undefined;
	/** `--shard` — a shard specifier such as `"1/3"`. */
	readonly shard?: string | undefined;
}

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
	 * always `undefined`. This field is only ever set by a caller
	 * constructing `AgentReporter` directly (e.g. a test, or a non-plugin
	 * embedding). The CLI `--project` flag (and every other CLI/programmatic
	 * scope filter) is caught by {@link CliScopeFilters} instead.
	 */
	readonly projectFilter: string | undefined;
	/**
	 * The stashed Vitest instance's `config.cliOptions`, narrowed to the
	 * run-scoping fields recognized by {@link CliScopeFilters}. Any
	 * recognized filter that is set makes the run partial (issue #401).
	 */
	readonly cliFilters: CliScopeFilters | undefined;
	/**
	 * `-t` / `--testNamePattern` snapshot-diff triple.
	 *
	 * @remarks
	 * Vitest copies the RESOLVED `testNamePattern` — `vitest.config.ts`'s
	 * `test.testNamePattern` merged with any `-t` flag — into
	 * `configOverride.testNamePattern` at startup, before any reporter's
	 * `onInit` runs (Vitest 5.0 `Vitest._setServer`).
	 * Reading `configOverride.testNamePattern` alone therefore cannot tell a
	 * permanent config-file pattern (which should NOT make every run
	 * partial) apart from a CLI `-t` or a watch-mode `t` keypress filter
	 * (which should). Three fields disambiguate:
	 * - `cli` — `config.cliOptions.testNamePattern`, the raw pre-resolution
	 *   CLI value. `undefined` for a config-file-only pattern (CLI options
	 *   never carry it); a non-empty string for `-t foo`; `""` for `-t ""`.
	 * - `initial` — the `configOverride.testNamePattern` snapshot taken once,
	 *   at `onInit`, before any watch-mode filtering can occur.
	 * - `current` — `configOverride.testNamePattern` read again at
	 *   `onTestRunEnd`. Identical to `initial` unless `Vitest.changeNamePattern`
	 *   (watch-mode `t`) or `setGlobalTestNamePattern` ran in between.
	 *
	 * See {@link hasTestNameFilter} for the decision rule over these three.
	 */
	readonly testNamePattern:
		| {
				readonly cli: string | RegExp | undefined;
				readonly initial: RegExp | undefined;
				readonly current: RegExp | undefined;
		  }
		| undefined;
}

/**
 * Stable comparison key for a `configOverride.testNamePattern` value: `""`
 * for `undefined`, otherwise `RegExp#toString()` (`/source/flags`) — two
 * distinct `RegExp` objects constructed from the same pattern compare equal.
 */
function testNamePatternKey(pattern: RegExp | undefined): string {
	return pattern === undefined ? "" : pattern.toString();
}

/**
 * Pure decision function: does the `{ cli, initial, current }` snapshot
 * indicate a per-run test-name filter (as opposed to the project's own
 * `vitest.config.ts`-declared `testNamePattern`)?
 *
 * @remarks
 * - When `initial` and `current` differ (by stable key, not identity): the
 *   run is partial iff `current` is truthy — a watch-mode filter was just
 *   applied (partial) or just cleared (full).
 * - When `initial` and `current` are the same: the run is partial iff `cli`
 *   is truthy — a CLI `-t foo` (partial), vs. `-t ""`/unset or a
 *   config-file-only pattern where `cli` is `undefined` (full either way).
 *
 * @public
 */
export function hasTestNameFilter(
	input:
		| {
				readonly cli: string | RegExp | undefined;
				readonly initial: RegExp | undefined;
				readonly current: RegExp | undefined;
		  }
		| undefined,
): boolean {
	if (input === undefined) return false;
	const { cli, initial, current } = input;
	if (testNamePatternKey(initial) !== testNamePatternKey(current)) {
		return current !== undefined;
	}
	return cli !== undefined && cli !== "";
}

/**
 * Pure predicate: does `cliFilters` carry at least one non-empty CLI/
 * programmatic scope filter?
 *
 * @remarks
 * Each field is checked independently so a single unset/empty field never
 * masks another that IS set:
 * - `project` — non-empty array, or non-empty string.
 * - `tagsFilter` — non-empty array.
 * - `changed` — `true`, or a non-empty ref string.
 * - `related` — non-empty array, or non-empty string.
 * - `shard` — any non-empty string.
 *
 * `testNamePattern` is NOT part of {@link CliScopeFilters} — it needs the
 * snapshot-diff rule in {@link hasTestNameFilter}, which {@link isPartialRun}
 * applies separately.
 *
 * @public
 */
export function hasCliScopeFilter(cliFilters: CliScopeFilters | undefined): boolean {
	if (cliFilters === undefined) return false;
	const { project, tagsFilter, changed, related, shard } = cliFilters;
	if (project !== undefined && project.length > 0) return true;
	if (tagsFilter !== undefined && tagsFilter.length > 0) return true;
	if (changed !== undefined && changed !== false) return true;
	if (related !== undefined && related.length > 0) return true;
	if (shard !== undefined && shard.length > 0) return true;
	return false;
}

/**
 * Pure decision function: was this Vitest run scoped to a subset of the
 * project's test files?
 *
 * @remarks
 * A run is partial when any of the following holds:
 * - Vitest's `filenamePattern` was set (a non-empty array) for this run.
 * - Fewer specifications started than exist in total for the same project set.
 * - `AgentReporter`'s construction-time `projectFilter` option was set (not
 *   the CLI `--project` flag — see {@link IsPartialRunInput.projectFilter}).
 * - Any recognized CLI/programmatic scope filter is set on `cliFilters`:
 *   `--project`, `--tags-filter`, `--changed`, `--related`, or `--shard`
 *   (issue #401).
 * - {@link hasTestNameFilter} finds a per-run test-name filter (`-t`, or a
 *   watch-mode `t` change) — NOT a permanent `vitest.config.ts`
 *   `testNamePattern`, which is the project's own scope and stays full.
 *
 * Any of these makes coverage's whole-project denominator meaningless for
 * threshold enforcement (issue #160).
 *
 * @public
 */
export function isPartialRun(input: IsPartialRunInput): boolean {
	const { filenamePattern, startedSpecCount, totalSpecCount, projectFilter, cliFilters, testNamePattern } = input;
	if (filenamePattern !== undefined && filenamePattern.length > 0) return true;
	if (startedSpecCount < totalSpecCount) return true;
	if (projectFilter !== undefined) return true;
	if (hasCliScopeFilter(cliFilters)) return true;
	if (hasTestNameFilter(testNamePattern)) return true;
	return false;
}
