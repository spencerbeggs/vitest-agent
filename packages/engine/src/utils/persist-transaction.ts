import { DataStoreError, extractSqlReason } from "@vitest-agent/sdk";
import { Context, Effect, Exit, References } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { isSqlError } from "effect/sql/SqlError";

/**
 * Per-transaction scratch state `DataStoreLive` consults while a
 * {@link withPersistTransaction} block is open. Everything here is only
 * valid inside that one write transaction: no other connection can delete
 * a `tags` / `files` row while the write lock is held, and the deferred
 * history prune runs before the same transaction commits. The collections
 * only grow while a batch is open; {@link withPersistSavepoint} truncates
 * them back to their size at savepoint open when the savepoint rolls back.
 *
 * @internal
 */
export interface PersistBatchState {
	/** `run_id`s whose `test_history` series still need the keep-10 prune. */
	readonly historyRunIds: Set<number>;
	/** `tags.name` -> `tags.id`, so a tag is looked up once per run, not once per test. */
	readonly tagIds: Map<string, number>;
	/** `files.path` -> `files.id`, so a path is looked up once per run. */
	readonly fileIds: Map<string, number>;
}

/**
 * The open persist batch, or `undefined` outside {@link withPersistTransaction}.
 * Read by `DataStoreLive`; not part of the public surface.
 *
 * @internal
 */
export const PersistBatch = Context.Reference<PersistBatchState | undefined>("@vitest-agent/engine/PersistBatch", {
	defaultValue: () => undefined,
});

/**
 * Drop every entry added after `size`. The caches only ever grow (an id for
 * a name never changes while the write lock is held), and a `Map` / `Set`
 * iterates in insertion order, so the entries past the snapshot size are
 * exactly the ones a rolled-back savepoint added.
 */
const truncate = (collection: Map<unknown, unknown> | Set<unknown>, size: number): void => {
	if (collection.size <= size) return;
	let index = 0;
	for (const key of collection.keys()) {
		if (index++ >= size) collection.delete(key);
	}
};

/**
 * Run `effect` as a nested transaction that keeps the
 * {@link withPersistTransaction} caches honest.
 *
 * Outside a persist batch this is exactly `sql.withTransaction(effect)`.
 * Inside one, the nested `withTransaction` becomes a SAVEPOINT, and when it
 * rolls back (a failure, a defect, an interrupt) every `files` / `tags` row
 * the savepoint inserted is gone while the ids `DataStoreLive` cached for
 * them would survive in `PersistBatchState`. This helper snapshots the
 * cache sizes before the savepoint opens and discards the entries added
 * since whenever it does not commit, so a later write in the same batch
 * re-inserts the row instead of referencing one that no longer exists
 * (issue #628: a FK failure or a dangling id). A savepoint that commits
 * keeps its entries.
 *
 * Use this, never a bare `sql.withTransaction`, for any nested transaction
 * whose failure a caller may catch and continue from inside the batch; a
 * bare one that rolls back leaves the caches stale. The bookkeeping is
 * synchronous, so the batch's no-yield guarantee is unchanged.
 *
 * @param effect - the writes to run as one savepoint (or transaction)
 * @public
 */
export const withPersistSavepoint = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SqlError, R | SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const batch = yield* PersistBatch;
		if (batch === undefined) return yield* sql.withTransaction(effect);
		const snapshot = {
			historyRunIds: batch.historyRunIds.size,
			tagIds: batch.tagIds.size,
			fileIds: batch.fileIds.size,
		};
		return yield* sql.withTransaction(effect).pipe(
			Effect.onExit((exit) =>
				Exit.isSuccess(exit)
					? Effect.void
					: Effect.sync(() => {
							truncate(batch.historyRunIds, snapshot.historyRunIds);
							truncate(batch.tagIds, snapshot.tagIds);
							truncate(batch.fileIds, snapshot.fileIds);
						}),
			),
		);
	});

/** Matches the per-write window `DataStoreLive.writeHistory` keeps outside a batch. */
const HISTORY_WINDOW = 10;

/**
 * Keep the newest {@link HISTORY_WINDOW} rows of every
 * `(project, module_path, full_name)` series that has a row from `runId`,
 * in one statement. The same rows the per-write prune deletes: a series is
 * unique on `(project, module_path, full_name, timestamp)`, so there are no
 * timestamp ties for `ROW_NUMBER` to break arbitrarily, and every series
 * this run wrote carries `run_id = runId` (the upsert overwrites it).
 */
const pruneHistoryForRun = (sql: SqlClient, runId: number) =>
	sql`DELETE FROM test_history WHERE id IN (
		SELECT id FROM (
			SELECT h.id, ROW_NUMBER() OVER (
				PARTITION BY h.project, h.module_path, h.full_name
				ORDER BY h.timestamp DESC
			) AS rn
			FROM test_history h
			JOIN (
				SELECT DISTINCT project, module_path, full_name FROM test_history WHERE run_id = ${runId}
			) a ON a.project = h.project AND a.module_path = h.module_path AND a.full_name = h.full_name
		) WHERE rn > ${HISTORY_WINDOW}
	)`;

/**
 * Run `effect` as one SQLite write transaction on the `data.db` connection:
 * every `DataStore` write inside it commits together or not at all, and a
 * failure rolls the whole block back before the error propagates.
 *
 * Built for the reporter's run-end persist phase, where per-statement
 * autocommits (one fsync each) dominated wall time. Inside the block
 * `DataStoreLive` caches tag and file ids and defers `writeHistory`'s
 * keep-10 prune to one statement per run, executed before commit; the
 * persisted rows are the same as without the block.
 *
 * The fiber does not yield to the scheduler while the block runs. node:sqlite
 * is synchronous, so the whole transaction executes in one turn of the event
 * loop: a second connection in the same process (another project's reporter,
 * or the MCP server's own connection while it runs Vitest in-process) can
 * neither interleave a write nor block the thread in SQLite's busy handler
 * while this connection holds the write lock. Keep `effect` free of
 * genuinely asynchronous work for that reason; CPU-heavy work that needs no
 * database belongs before the block.
 *
 * Nested `withTransaction` calls inside `effect` become savepoints. Open
 * them through {@link withPersistSavepoint}: a savepoint that rolls back
 * also discards the tag / file ids cached while it was open, so a write the
 * caller recovers from cannot leave a later write pointing at a row the
 * rollback removed. A bare nested `sql.withTransaction` whose failure is
 * caught inside the block leaves those caches stale. A `DataReader` query
 * inside the block runs on the transaction's connection.
 *
 * @param effect - the writes (and the reads they depend on) to run atomically
 * @public
 */
export const withPersistTransaction = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | DataStoreError, R | SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const batch: PersistBatchState = { historyRunIds: new Set(), tagIds: new Map(), fileIds: new Map() };
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				const result = yield* effect.pipe(Effect.provideService(PersistBatch, batch));
				for (const runId of batch.historyRunIds) {
					yield* pruneHistoryForRun(sql, runId).pipe(
						Effect.mapError(
							(e) => new DataStoreError({ operation: "write", table: "test_history", reason: extractSqlReason(e) }),
						),
					);
				}
				return result;
			}),
		);
	}).pipe(
		Effect.provideService(References.PreventSchedulerYield, true),
		// BEGIN / COMMIT failures (a SQLITE_BUSY on BEGIN IMMEDIATE, a failed
		// COMMIT) surface as SqlError from withTransaction itself.
		Effect.catchIf(isSqlError, (e) =>
			Effect.fail(new DataStoreError({ operation: "write", table: "transaction", reason: extractSqlReason(e) })),
		),
	);
