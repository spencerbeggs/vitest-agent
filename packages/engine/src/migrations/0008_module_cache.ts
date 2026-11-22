// Post-2.0 incremental migration (issue 741: persist module cache effectiveness).
//
// Vitest's fs module cache (`fsModuleCache`) has no hit or miss counters, so
// the reporter derives a per-project stat (sdk `ModuleCacheStat`): the time
// files spent transforming and serving modules (`setupFetchDuration +
// collectFetchDuration`), the project's tracked time, whether the cache was
// on, and how many cache entries the run wrote. Until now it lived only in the
// in-memory reports and `run.json`, so `test_history` and `triage_brief`
// could not show a cold run against a warm one.
//
// It is per project, so it lands on the project's `test_runs` row. The table
// has live readers and writers, so this is the ALTER path: four nullable
// columns, no backfill. NULL means the run recorded no stat (no timing data, a
// run that predates this migration). `module_cache_modules_written` is NULL on
// its own when the cache was off or its directory could not be read. The share
// is not stored: it is `transform_ms / tracked_ms`.

import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

/** @internal */
const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	yield* sql`ALTER TABLE test_runs ADD COLUMN module_cache_enabled INTEGER`;
	yield* sql`ALTER TABLE test_runs ADD COLUMN module_cache_transform_ms REAL`;
	yield* sql`ALTER TABLE test_runs ADD COLUMN module_cache_tracked_ms REAL`;
	yield* sql`ALTER TABLE test_runs ADD COLUMN module_cache_modules_written INTEGER`;
});

/** @public */
export default migration;
