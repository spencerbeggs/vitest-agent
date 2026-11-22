// Post-2.0 incremental migration (issue 735: persist per-attempt test results).
//
// Vitest 5.1's `TestCase.attempts()` reports one result per retry and repeat
// attempt of a test. `test_cases` only keeps the final state and the retry /
// repeat counts, so which attempt failed (and how) was lost. `test_attempts`
// is a child of `test_cases` with one row per attempt; `ON DELETE CASCADE`
// follows the same rule as every other test_cases child, so run retention
// (0003) reaps attempts with their cases.
//
// Attempt errors link back through a nullable `test_errors.attempt_id`
// (ALTER, no backfill: existing rows, and errors outside any attempt such as
// suite, module and unhandled errors, stay NULL). That is the minimal link:
// an errors child table would duplicate the whole test_errors shape and its
// stack_frames / failure_signatures wiring.

import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

/** @internal */
const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	yield* sql`
		CREATE TABLE test_attempts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			test_case_id INTEGER NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
			retry_index INTEGER NOT NULL,
			repeat_index INTEGER NOT NULL,
			state TEXT NOT NULL CHECK (state IN ('passed', 'failed', 'skipped')),
			duration REAL,
			start_time REAL
		)
	`;
	yield* sql`CREATE INDEX idx_test_attempts_case ON test_attempts(test_case_id)`;
	yield* sql`ALTER TABLE test_errors ADD COLUMN attempt_id INTEGER REFERENCES test_attempts(id) ON DELETE CASCADE`;
	yield* sql`CREATE INDEX idx_test_errors_attempt ON test_errors(attempt_id)`;
});

/** @public */
export default migration;
