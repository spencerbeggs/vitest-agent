/**
 * The one read the discovery probes make outside a walk: a stat that answers
 * `null` instead of throwing. Every walk itself is `@effected/walker`'s
 * `descendSync` / `descendEntriesSync` over the caller's `WalkerSyncOps`
 * (`nodeWalkerSyncOps` in production, a virtual volume in tests).
 *
 * @packageDocumentation
 */

import type { WalkerSyncOps, WalkerSyncStats } from "@effected/walker";

/** `stat` of `path`, links followed, or `null` when it is missing or unreadable. */
export function statOrNull(ops: WalkerSyncOps, path: string): WalkerSyncStats | null {
	try {
		return ops.fileSystem.stat(path);
	} catch {
		return null;
	}
}
