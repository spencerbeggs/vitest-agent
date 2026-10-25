/**
 * The environment variable an operator sets to override `AgentPlugin`'s
 * `persist` option when the config cannot be edited (issue #625).
 */
export const PERSIST_ENV_VAR = "VITEST_AGENT_PERSIST";

/** Values of `VITEST_AGENT_PERSIST` that turn persistence off (compared lower-cased and trimmed). */
const OFF_VALUES = new Set(["0", "false", "off"]);
/** Values of `VITEST_AGENT_PERSIST` that turn persistence on (compared lower-cased and trimmed). */
const ON_VALUES = new Set(["1", "true", "on"]);

/**
 * Input to {@link resolvePersistence}.
 *
 * @public
 */
export interface ResolvePersistenceInput {
	/** The user's `AgentPlugin({ persist })` option, `undefined` when omitted. */
	readonly option: boolean | undefined;
	/** The environment to read `VITEST_AGENT_PERSIST` from. */
	readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Decision returned by {@link resolvePersistence}.
 *
 * `source` names what decided it: the env var, the option, or neither
 * (the default). `ignoredEnvValue` is present when `VITEST_AGENT_PERSIST`
 * was set to something unrecognized, so the caller can say so once on
 * stderr the way the `VITEST_AGENT_CONSOLE` override does.
 *
 * @public
 */
export interface PersistenceDecision {
	readonly persist: boolean;
	readonly source: "env" | "option" | "default";
	readonly ignoredEnvValue?: string;
}

/**
 * Pure decision: should this run be recorded in the SQLite `data.db`?
 *
 * @remarks
 * The env var is an operator override and wins over the option in either
 * direction — `VITEST_AGENT_PERSIST=0` turns persistence off under
 * `persist: true`, and `=1` turns it back on under `persist: false` — so a
 * runner whose `vitest.config.ts` is not editable can still decide. An
 * empty value is unset. Nothing here reads `CI`: the opt-out is explicit
 * by design, because some CI setups cache `data.db` between jobs and
 * query it, and an automatic opt-out would silently empty their history.
 *
 * @public
 */
export function resolvePersistence(input: ResolvePersistenceInput): PersistenceDecision {
	const raw = input.env[PERSIST_ENV_VAR];
	let ignoredEnvValue: string | undefined;
	if (raw !== undefined && raw.trim() !== "") {
		const normalized = raw.trim().toLowerCase();
		if (OFF_VALUES.has(normalized)) return { persist: false, source: "env" };
		if (ON_VALUES.has(normalized)) return { persist: true, source: "env" };
		ignoredEnvValue = raw;
	}
	const fromOption: PersistenceDecision =
		input.option === undefined ? { persist: true, source: "default" } : { persist: input.option, source: "option" };
	return ignoredEnvValue === undefined ? fromOption : { ...fromOption, ignoredEnvValue };
}
