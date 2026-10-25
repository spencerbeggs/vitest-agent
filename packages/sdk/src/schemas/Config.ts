import { Option, Schema } from "effect";

/** A whole number of runs or days, at least one. */
const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/**
 * The optional `[retention]` table of `vitest-agent.config.toml`: how many
 * `test_runs` rows (and their cascaded modules, cases, errors, coverage
 * rows) the per-project `data.db` keeps.
 *
 * Every field is optional. An absent table means the default policy
 * (`RunRetentionPolicy.DEFAULT_KEEP_RUNS` newest runs per project, no age
 * limit); `enabled = false` turns run pruning off entirely.
 *
 * Fields:
 * - `enabled` — `false` disables run retention. Defaults to `true`.
 * - `keepRuns` — the newest N runs per project to keep. A positive integer;
 *   defaults to `RunRetentionPolicy.DEFAULT_KEEP_RUNS`.
 * - `maxAgeDays` — additionally drop any run older than this many days,
 *   even inside the newest N. A positive integer; no age limit by default.
 *
 * @remarks
 * `keepRuns = 0` is rejected rather than read as "keep nothing": the run
 * being written is always kept, and `enabled = false` is the explicit
 * off switch, so a zero would have two readings.
 * @public
 */
export class RetentionConfig extends Schema.Class<RetentionConfig>("RetentionConfig")({
	enabled: Schema.optionalKey(Schema.Boolean),
	keepRuns: Schema.optionalKey(PositiveInt),
	maxAgeDays: Schema.optionalKey(PositiveInt),
}) {}

/**
 * Schema for the optional `vitest-agent.config.toml` file.
 *
 * Every field is optional. When the file is absent or these fields are
 * unset, `resolveDataPath` falls back to deriving the path from the
 * workspace's `package.json` `name` under the XDG data directory, and run
 * retention uses the default policy.
 *
 * Fields:
 * - `cacheDir` — absolute path overriding the entire data directory. Highest
 *   precedence after the programmatic option. Use this to relocate the SQLite
 *   database (e.g. project-local `.vitest-agent/`) instead of the
 *   default XDG location.
 * - `projectKey` — overrides the workspace key segment under the XDG data
 *   directory. Use this when two unrelated projects on the same machine
 *   share a `package.json` `name` (the collision case for workspace-name
 *   keying), or when you want a stable key independent of `name` changes.
 * - `retention` — the `[retention]` table; see `RetentionConfig`.
 * @public
 */
export class VitestAgentConfig extends Schema.Class<VitestAgentConfig>("VitestAgentConfig")({
	cacheDir: Schema.optional(Schema.String),
	projectKey: Schema.optional(Schema.String),
	retention: Schema.optionalKey(RetentionConfig),
}) {}

/**
 * The resolved run-retention policy a `data.db` prune applies: keep the
 * newest `keepRuns` runs of every project, and drop any run older than
 * `maxAgeDays` days when set. The run being persisted is never pruned.
 *
 * @remarks
 * The default of 200 runs per project is sized against what reads the
 * data: failure classification reads the newest 10 `test_history` rows per
 * test and coverage trends keep 50 entries, so 200 leaves both a wide
 * margin while bounding a 7k-test suite (about 3 MB per run) to a few
 * hundred megabytes instead of growing without bound (issue 623, where an
 * unpruned database reached 880 MB over 4,484 runs). `maxAgeDays` is the
 * lever for a project that runs rarely but wants a calendar bound.
 * @public
 */
export class RunRetentionPolicy extends Schema.Class<RunRetentionPolicy>("RunRetentionPolicy")({
	keepRuns: PositiveInt,
	maxAgeDays: Schema.optionalKey(PositiveInt),
}) {
	/** Newest runs per project kept when the config names no `keepRuns`. */
	static readonly DEFAULT_KEEP_RUNS = 200;

	/**
	 * Resolve the policy a loaded config asks for: `Option.none()` when
	 * `retention.enabled` is `false`, otherwise the configured values over
	 * the defaults.
	 */
	static fromConfig(config: VitestAgentConfig): Option.Option<RunRetentionPolicy> {
		const retention = config.retention;
		if (retention?.enabled === false) return Option.none();
		return Option.some(
			RunRetentionPolicy.make({
				keepRuns: retention?.keepRuns ?? RunRetentionPolicy.DEFAULT_KEEP_RUNS,
				...(retention?.maxAgeDays !== undefined && { maxAgeDays: retention.maxAgeDays }),
			}),
		);
	}
}
