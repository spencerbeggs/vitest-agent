import type { CacheManifest, CacheManifestEntry } from "../schemas/CacheManifest.js";
import type { TestRun } from "../schemas/History.js";

// ---------------------------------------------------------------------------
// Input row types (minimal -- only the fields each assembler needs)
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a test_runs aggregation row used to build the manifest.
 * @public
 */
export interface ManifestRow {
	project: string;
	sub_project: string | null;
	timestamp: string;
	reason: string;
}

/**
 * Minimal shape of a test_history row used to build a history record.
 * @public
 */
export interface HistoryRow {
	module_path: string;
	full_name: string;
	timestamp: string;
	state: string;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * A `Record<compositeKey, { modulePath, fullName, runs: TestRun[] }>` keyed by
 * the composite `${modulePath} ${fullName}` string, so identically-named
 * tests in different files are tracked as distinct entries.
 *
 * This is the internal representation returned by `assembleHistoryRecord`.
 * Callers that need the Effect Schema `HistoryRecord` type should adapt this
 * into the `tests` array format.
 * @public
 */
export interface AssembledHistoryRecord {
	[compositeKey: string]: { modulePath: string; fullName: string; runs: TestRun[] };
}

// ---------------------------------------------------------------------------
// assembleManifest
// ---------------------------------------------------------------------------

/**
 * Builds a `CacheManifest` from an array of test_runs aggregation rows.
 *
 * Each row represents the latest run for a project/sub_project pair.
 * The `dbPath` is stored as `cacheDir` so CLI tools can locate the source.
 * @public
 */
export function assembleManifest(rows: ManifestRow[], dbPath: string): CacheManifest {
	const updatedAt = rows.reduce<string>((latest, row) => {
		return row.timestamp > latest ? row.timestamp : latest;
	}, new Date(0).toISOString());

	const projects: CacheManifestEntry[] = rows.map((row) => {
		const projectName = row.sub_project ? `${row.project}:${row.sub_project}` : row.project;
		const safeProjectName = projectName.replace(/[^a-z0-9@._-]/gi, "_");
		// Virtual paths with "sql:" prefix — these are identifiers, not real
		// filesystem paths. Data is read from SQLite via DataReader, not from
		// files. The prefix distinguishes Phase 5+ SQL-backed manifests from
		// Phase 4 JSON file-backed manifests.
		const reportFile = `sql:reports/${safeProjectName}.json`;
		const historyFile = `sql:history/${safeProjectName}.history.json`;

		const lastResult = ((): CacheManifestEntry["lastResult"] => {
			if (row.reason === "passed" || row.reason === "failed" || row.reason === "interrupted") {
				return row.reason;
			}
			return null;
		})();

		return {
			project: projectName,
			reportFile,
			historyFile,
			lastRun: row.timestamp,
			lastResult,
		};
	});

	return {
		updatedAt,
		cacheDir: dbPath,
		projects,
	};
}

// ---------------------------------------------------------------------------
// assembleHistoryRecord
// ---------------------------------------------------------------------------

/**
 * Groups test_history rows by the composite (module_path, full_name) key
 * into a keyed record.
 *
 * Returns `Record<compositeKey, { modulePath, fullName, runs: TestRun[] }>`
 * where `runs` are the accumulated test runs for that test, in the order
 * they appear in `rows`. Two rows sharing `full_name` but differing
 * `module_path` are tracked as distinct entries rather than merged.
 *
 * Only rows with state `"passed"` or `"failed"` are included in runs
 * (matching the `TestRun` schema constraint).
 * @public
 */
export function assembleHistoryRecord(rows: HistoryRow[]): AssembledHistoryRecord {
	const record: AssembledHistoryRecord = {};

	for (const row of rows) {
		const state = row.state === "passed" || row.state === "failed" ? row.state : null;
		if (state === null) continue;

		const key = `${row.module_path} ${row.full_name}`;
		if (!record[key]) {
			record[key] = { modulePath: row.module_path, fullName: row.full_name, runs: [] };
		}

		record[key].runs.push({
			timestamp: row.timestamp,
			state,
		});
	}

	return record;
}
