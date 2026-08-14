/**
 * Pure decision logic backing `bin.ts`'s `process.on("uncaughtException")`
 * guard (issue #191, sub-item A).
 *
 * Node's own guidance for `uncaughtException` is "do not resume normal
 * operation" because arbitrary in-process state may be corrupt. This
 * package accepts that residual risk *after* the stdio transport is
 * connected: it holds no long-lived mutable state outside SQLite
 * itself (every `DataStore`/`DataReader` call is a self-contained
 * transaction via the shared `ManagedRuntime`), so a synchronous throw
 * that escapes even the MCP SDK's own per-tool-call try/catch cannot
 * leave this process's own bookkeeping half-mutated in a way that
 * would corrupt the *next* call — and the alternative, silent process
 * death mid-TDD-session (deregistering every tool from the client), is
 * strictly worse for a long-running dev tool.
 *
 * Before the transport connects there is no client session to
 * preserve by staying alive, so failing fast and loud is the better
 * default rather than spinning forever in a half-initialized state.
 *
 * @packageDocumentation
 */

/**
 * @param transportConnected - whether `server.connect(transport)` has
 *   already resolved for this process
 * @returns `true` when the process should exit rather than continue
 * @public
 */
export function shouldExitOnUncaughtException(transportConnected: boolean): boolean {
	return !transportConnected;
}
