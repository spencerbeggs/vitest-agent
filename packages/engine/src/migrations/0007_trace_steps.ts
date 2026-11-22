// Post-2.0 incremental migration (issue 737: persist trace-timeline steps).
//
// Vitest 5.1's `experimental.traceTimeline` records the steps of a failed
// attempt as an `internal:browserTrace` artifact. The reporter normalises the
// failed attempt's last steps (name, status, start, duration, nesting depth,
// locator, location) and `test_trace_steps` keeps them, one row per step, so
// the MCP `test_errors` tool can serve them after the console frame is gone.
//
// A child of `test_cases` (cascade, like every other test_cases child, so run
// retention from 0003 reaps steps with their cases) and, when the failed
// attempt is known, of the `test_attempts` row from 0006. `ordinal` keeps the
// step order; the table is new, so there is nothing to backfill.

import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

/** @internal */
const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	yield* sql`
		CREATE TABLE test_trace_steps (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			test_case_id INTEGER NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
			attempt_id INTEGER REFERENCES test_attempts(id) ON DELETE CASCADE,
			ordinal INTEGER NOT NULL,
			name TEXT NOT NULL,
			status TEXT CHECK (status IS NULL OR status IN ('pass', 'fail')),
			start_time REAL NOT NULL,
			duration REAL,
			depth INTEGER NOT NULL DEFAULT 0,
			locator TEXT,
			location_file TEXT,
			location_line INTEGER,
			location_column INTEGER
		)
	`;
	yield* sql`CREATE INDEX idx_test_trace_steps_case ON test_trace_steps(test_case_id, ordinal)`;
	yield* sql`CREATE INDEX idx_test_trace_steps_attempt ON test_trace_steps(attempt_id)`;
});

/** @public */
export default migration;
