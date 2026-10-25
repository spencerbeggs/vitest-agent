// Post-2.0 incremental migration (issue 578: persist a run's stray output).
//
// `strayOutput` (sdk `StrayOutput`) counts the bytes and lines a run wrote
// straight to the terminal past Vitest's console capture — a worker's own
// stdout/stderr, or a child it spawned with inherited stdio — and keeps the
// first few lines as samples. Until now it lived only in the in-memory
// reports and `run.json`, so `triage_brief` and `test_history` could not see
// a suite that keeps leaking. It is a run-level signal (one copy per project
// row of an invocation), so it lands on `test_runs`.
//
// `test_runs` has live readers and writers, so this is the ALTER path: five
// nullable columns, no backfill. NULL means the run recorded nothing (or the
// run predates this migration, or the plugin did not own the console).
// The samples ride as a JSON array of `{ stream, text }`, already capped by
// the sdk recorder (five lines of 160 characters), mirroring `host_metadata`.

import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

/** @internal */
const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	yield* sql`ALTER TABLE test_runs ADD COLUMN stray_total INTEGER`;
	yield* sql`ALTER TABLE test_runs ADD COLUMN stray_stdout INTEGER`;
	yield* sql`ALTER TABLE test_runs ADD COLUMN stray_stderr INTEGER`;
	yield* sql`ALTER TABLE test_runs ADD COLUMN stray_bytes INTEGER`;
	yield* sql`ALTER TABLE test_runs ADD COLUMN stray_samples TEXT`;
});

/** @public */
export default migration;
