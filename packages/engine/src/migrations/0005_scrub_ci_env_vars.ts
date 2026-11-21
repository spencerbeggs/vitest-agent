// Post-2.0 incremental migration: scrub CI variables the reporter should never
// have persisted.
//
// Under GitHub Actions the plugin's `captureEnvVars` used to keep every
// `GITHUB_*` and `RUNNER_*` variable in the environment. A workflow can export
// a secret under that prefix (`GITHUB_TOKEN`, a `GITHUB_*` deploy key), and
// `settings_env_vars` is served back by the MCP `configure` tool. The plugin
// now records a fixed list of run coordinates; this deletes every other
// `GITHUB_*` / `RUNNER_*` row a database already holds.
//
// The list is frozen here on purpose: a migration is a record of what ran, so
// it does not follow later changes to the plugin's list. `settings_env_vars`
// has live readers and writers, but these rows are exactly the ones no current
// writer produces, so deleting them loses nothing a reader relies on.

import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

const KEPT = [
	"GITHUB_ACTIONS",
	"GITHUB_RUN_ID",
	"GITHUB_RUN_ATTEMPT",
	"GITHUB_JOB",
	"GITHUB_SHA",
	"GITHUB_REF_NAME",
	"RUNNER_OS",
	"RUNNER_ARCH",
] as const;

/** @internal */
const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	yield* sql`
		DELETE FROM settings_env_vars
		WHERE (key LIKE 'GITHUB\\_%' ESCAPE '\\' OR key LIKE 'RUNNER\\_%' ESCAPE '\\')
			AND key NOT IN ${sql.in(KEPT)}`;
});

/** @public */
export default migration;
