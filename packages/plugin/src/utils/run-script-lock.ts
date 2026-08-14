/**
 * File-based advisory lock backing `AgentPlugin.runScript` (issue #191,
 * sub-item B). Two concurrent `vitest` invocations in one checkout used
 * to both run the `globalSetup` build and race — this lock serializes
 * them: the first process to acquire the lock runs the command and
 * marks a "done" timestamp on success; a concurrent process polls,
 * and once the marker is fresh enough (`builtRecentlyMs`) it trusts
 * the winner's build and skips its own.
 *
 * A stale-lock takeover (`staleMs`) exists because a process that
 * crashed or was killed mid-build leaves the lock file behind forever
 * otherwise — every future `vitest` invocation would hang. A generous
 * `waitTimeoutMs` safety valve exists so a genuinely slow (but still
 * live) build doesn't hang the waiter forever either: past that
 * timeout the waiter gives up and runs its own build independently,
 * which reproduces the original race for that one pair of processes
 * rather than blocking indefinitely — a deliberate, documented
 * tradeoff, not an oversight.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A build that's still "in progress" past this age is presumed abandoned (crashed process, killed job) and its lock is taken over. */
export const DEFAULT_LOCK_STALE_MS = 5 * 60 * 1000;
/** How long a waiter sleeps between polls of an active lock. */
export const DEFAULT_LOCK_POLL_MS = 200;
/** How long a waiter blocks before giving up and running its own build independently. */
export const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
/** A done-marker fresher than this is trusted without re-running the command. */
export const DEFAULT_BUILT_RECENTLY_MS = 30 * 1000;

/**
 * Resolves the directory `runScript` locks and done-markers live in:
 * `XDG_DATA_HOME` when set (matching `@vitest-agent/sdk`'s `data.db`
 * resolution convention), else the same `~/.local/share` fallback that
 * convention documents.
 *
 * @public
 */
export function resolveRunScriptLockDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
	const xdg = env.XDG_DATA_HOME;
	const base = xdg !== undefined && xdg.length > 0 ? xdg : join(home, ".local", "share");
	return join(base, "vitest-agent", "runscript-locks");
}

/**
 * Deterministic, filesystem-safe key for one (workspace, command) pair
 * so different `globalSetup` commands in the same checkout don't share
 * a lock, while repeat invocations of the *same* command in the *same*
 * workspace do.
 */
function computeLockKey(cwd: string, command: string): string {
	return createHash("sha256").update(`${cwd}\n${command}`).digest("hex").slice(0, 16);
}

/**
 * A held or observed advisory lock. `acquired` is `true` only when
 * this call created the lock file and therefore owns releasing it;
 * `recentlyBuilt` is `true` when a concurrent winner's build is fresh
 * enough to trust instead.
 *
 * @public
 */
export interface RunScriptLock {
	readonly lockPath: string;
	readonly doneMarkerPath: string;
	readonly acquired: boolean;
	readonly recentlyBuilt: boolean;
}

/**
 * @public
 */
export interface AcquireRunScriptLockOptions {
	readonly cwd: string;
	readonly command: string;
	readonly lockDir?: string;
	readonly staleMs?: number;
	readonly waitTimeoutMs?: number;
	readonly pollMs?: number;
	readonly builtRecentlyMs?: number;
	/**
	 * Injection point for tests. Production default blocks the calling
	 * thread synchronously via `Atomics.wait` (there is no async story
	 * here — `runScript` is a synchronous Vitest `globalSetup` helper).
	 */
	readonly sleep?: (ms: number) => void;
}

function defaultSleep(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRecentlyBuilt(doneMarkerPath: string, builtRecentlyMs: number): boolean {
	try {
		return Date.now() - statSync(doneMarkerPath).mtimeMs < builtRecentlyMs;
	} catch {
		return false;
	}
}

function lockAgeMs(lockPath: string): number | null {
	try {
		return Date.now() - statSync(lockPath).mtimeMs;
	} catch {
		return null;
	}
}

/**
 * Acquires (or observes) the advisory lock for one (cwd, command) pair.
 * Blocks the calling thread (via `sleep`) while another process holds
 * a non-stale lock, up to `waitTimeoutMs`.
 *
 * @public
 */
export function acquireRunScriptLock(options: AcquireRunScriptLockOptions): RunScriptLock {
	const {
		cwd,
		command,
		lockDir = resolveRunScriptLockDir(),
		staleMs = DEFAULT_LOCK_STALE_MS,
		waitTimeoutMs = DEFAULT_LOCK_WAIT_TIMEOUT_MS,
		pollMs = DEFAULT_LOCK_POLL_MS,
		builtRecentlyMs = DEFAULT_BUILT_RECENTLY_MS,
		sleep = defaultSleep,
	} = options;

	mkdirSync(lockDir, { recursive: true });
	const key = computeLockKey(cwd, command);
	const lockPath = join(lockDir, `${key}.lock`);
	const doneMarkerPath = join(lockDir, `${key}.done`);

	const deadline = Date.now() + waitTimeoutMs;
	for (;;) {
		// Checked at the top of every iteration, not only on the EEXIST
		// branch below: the winner releases its lock file (rmSync) *after*
		// marking the done marker, so a waiter whose poll lands in that
		// gap would otherwise see the lock as free, re-acquire it, and
		// re-run the command — defeating the marker's whole purpose.
		if (isRecentlyBuilt(doneMarkerPath, builtRecentlyMs)) {
			return { lockPath, doneMarkerPath, acquired: false, recentlyBuilt: true };
		}

		try {
			const fd = openSync(lockPath, "wx");
			writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
			closeSync(fd);
			return { lockPath, doneMarkerPath, acquired: true, recentlyBuilt: false };
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		}

		const age = lockAgeMs(lockPath);
		if (age !== null && age > staleMs) {
			try {
				rmSync(lockPath, { force: true });
			} catch {
				// Raced another taker — loop and retry the exclusive create.
			}
			continue;
		}

		if (Date.now() > deadline) {
			// Gave up waiting on a lock that is still held by a live (non-stale)
			// process. Running our own build independently reproduces the
			// original race for this one pair of processes, but a slow-yet-
			// successful concurrent build is a far better failure mode than
			// hanging the caller's test run forever.
			return { lockPath, doneMarkerPath, acquired: false, recentlyBuilt: false };
		}

		sleep(pollMs);
	}
}

/**
 * Releases a lock this process acquired. No-op when `lock.acquired` is
 * `false` (this process never owned it).
 *
 * @public
 */
export function releaseRunScriptLock(lock: RunScriptLock): void {
	if (!lock.acquired) return;
	try {
		rmSync(lock.lockPath, { force: true });
	} catch {
		// Already gone — a stale takeover raced us. Fine.
	}
}

/**
 * Marks a successful build, so a waiter's next `isRecentlyBuilt` check
 * can skip re-running the command. Best-effort: a write failure just
 * means the next process won't short-circuit, not a correctness
 * problem.
 *
 * @public
 */
export function markRunScriptDone(lock: RunScriptLock): void {
	try {
		writeFileSync(lock.doneMarkerPath, String(Date.now()));
	} catch {
		// Best-effort — see doc comment above.
	}
}
