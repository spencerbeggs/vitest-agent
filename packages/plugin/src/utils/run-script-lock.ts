/**
 * File-based advisory lock backing `AgentPlugin.runScript` (issue #191,
 * sub-item B). Two concurrent `vitest` invocations in one checkout used
 * to both run the `globalSetup` build and race — this lock serializes
 * them: the first process to acquire the lock runs the command and
 * marks a "done" timestamp on success; a concurrent process polls,
 * and once the marker is fresh enough (`builtRecentlyMs`) it trusts
 * the winner's build and skips its own.
 *
 * A stale-lock takeover exists because a process that crashed or was
 * killed mid-build leaves the lock file behind forever otherwise —
 * every future `vitest` invocation would hang. Takeover is a two-tier
 * rule, never age alone:
 *
 * 1. The lock file records the owner's pid. Once the lock is older
 *    than `staleMs`, that pid is probed with `process.kill(pid, 0)`.
 *    A live owner (probe succeeds, or fails `EPERM` — the process
 *    exists but belongs to another user) is NEVER taken over, no
 *    matter how old the lock is: a slow-but-live build must not have
 *    its lock stolen and the command double-run.
 * 2. Only a dead owner (`ESRCH`), or a lock file whose owner record is
 *    missing/corrupt (in which case age is all we have to go on),
 *    is taken over.
 *
 * Release is ownership-gated for the same reason: `acquireRunScriptLock`
 * stamps a random per-acquisition nonce into the lock file, and
 * `releaseRunScriptLock` deletes the file only when the nonce on disk is
 * still its own. Without that, an original owner that lost its lock to a
 * takeover would delete the *takeover* owner's lock in its `finally`,
 * letting a third process in while the second is still building.
 *
 * A generous `waitTimeoutMs` safety valve exists so a genuinely slow
 * (but still live) build doesn't hang the waiter forever either: past
 * that timeout the waiter gives up, `acquireRunScriptLock` returns
 * `{ acquired: false, recentlyBuilt: false }`, and the caller
 * (`AgentPlugin.runScript`) goes ahead and runs its own command
 * unserialized. That reproduces the original race for that one pair of
 * processes rather than blocking indefinitely — a deliberate,
 * documented escape valve, not an oversight.
 *
 * @packageDocumentation
 */

import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * A build whose owning process is *gone* and whose lock is older than
 * this is presumed abandoned (crashed process, killed job) and taken
 * over. Age alone never triggers a takeover — the recorded pid is
 * probed first, and a live owner keeps its lock past this age (see the
 * module doc comment). One minute comfortably covers the `globalSetup`
 * build steps this lock is built for; the pid probe is what protects
 * the longer ones.
 */
export const DEFAULT_LOCK_STALE_MS = 60 * 1000;
/** How long a waiter sleeps between polls of an active lock. */
export const DEFAULT_LOCK_POLL_MS = 200;
/** Floor for a poll interval supplied through an env override — a zero/sub-millisecond poll busy-spins the waiter. */
export const MIN_LOCK_POLL_MS = 10;
/** How long a waiter blocks before giving up and running its own build independently. */
export const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
/** A done-marker fresher than this is trusted without re-running the command. */
export const DEFAULT_BUILT_RECENTLY_MS = 30 * 1000;

/**
 * Strictly parses a millisecond timing supplied through one of the
 * `VITEST_AGENT_RUNSCRIPT_*` env overrides, falling back to `fallback`
 * for anything that is not a whole positive integer at or above
 * `minimum`.
 *
 * `Number.parseInt` is deliberately not used on its own: it happily
 * accepts `"200ms"` (→ 200) and `"-1"` (→ a negative stale window,
 * which makes every lock instantly stale) and `"0"` for a poll interval
 * (a tight spin loop). An unusable override falls back to the default
 * rather than silently degrading the lock.
 *
 * @public
 */
export function parseLockTimingOverride(raw: string | undefined, fallback: number, minimum = 1): number {
	if (raw === undefined) return fallback;
	const trimmed = raw.trim();
	// Whole-string digits only: rejects "200ms", "1e3", "1.5", "-1", "+1", "".
	if (!/^\d+$/.test(trimmed)) return fallback;
	const parsed = Number.parseInt(trimmed, 10);
	if (!Number.isSafeInteger(parsed) || parsed < minimum) return fallback;
	return parsed;
}

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
	/**
	 * Random per-acquisition token stamped into the lock file, `null`
	 * when this call did not acquire the lock. `releaseRunScriptLock`
	 * deletes the lock file only while the token on disk still matches
	 * this one — see the module doc comment.
	 */
	readonly ownerNonce: string | null;
}

/** Shape written into the lock file so a waiter can probe the owner and a releaser can prove ownership. */
interface LockOwnerRecord {
	readonly pid: number;
	readonly nonce: string;
	readonly startedAt: string;
}

/** Reads the owner record from a lock file. Returns `null` when the file is missing, unreadable, or not a well-formed owner record (e.g. observed mid-write by its creator). */
function readLockOwner(lockPath: string): LockOwnerRecord | null {
	let raw: string;
	try {
		raw = readFileSync(lockPath, "utf8");
	} catch {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<LockOwnerRecord>;
		if (typeof parsed?.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
		if (typeof parsed.nonce !== "string" || parsed.nonce.length === 0) return null;
		return { pid: parsed.pid, nonce: parsed.nonce, startedAt: String(parsed.startedAt ?? "") };
	} catch {
		return null;
	}
}

/**
 * Signal-0 liveness probe. `EPERM` means the process exists but is
 * owned by another user — still alive, and emphatically not ours to
 * take over. Anything else (`ESRCH`) means it is gone.
 */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
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
			return { lockPath, doneMarkerPath, acquired: false, recentlyBuilt: true, ownerNonce: null };
		}

		let fd: number | null = null;
		try {
			fd = openSync(lockPath, "wx");
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		}

		if (fd !== null) {
			const ownerNonce = randomBytes(12).toString("hex");
			const record: LockOwnerRecord = {
				pid: process.pid,
				nonce: ownerNonce,
				startedAt: new Date().toISOString(),
			};
			try {
				writeSync(fd, JSON.stringify(record));
			} catch (err) {
				// This attempt created `lockPath` but never finished initializing
				// it. Leaving it behind orphans the lock: every later caller would
				// stall until stale recovery or its own wait timeout, for a lock
				// nobody holds. Remove what we created before rethrowing.
				try {
					rmSync(lockPath, { force: true });
				} catch {
					// Best-effort cleanup — the original write error is what matters.
				}
				throw err;
			} finally {
				try {
					closeSync(fd);
				} catch {
					// Nothing actionable: the descriptor is being abandoned either way.
				}
			}
			return { lockPath, doneMarkerPath, acquired: true, recentlyBuilt: false, ownerNonce };
		}

		const age = lockAgeMs(lockPath);
		if (age !== null && age > staleMs) {
			// Two-tier staleness: age alone is not evidence of abandonment. Probe
			// the recorded owner — a live one keeps its lock however old it is
			// (mtime is never refreshed during a build, so a long-but-healthy
			// build looks "stale" by age). Only a dead owner, or a lock file with
			// no readable owner record (mid-write, truncated, hand-edited), falls
			// back to the age rule.
			const owner = readLockOwner(lockPath);
			if (owner === null || !isProcessAlive(owner.pid)) {
				try {
					rmSync(lockPath, { force: true });
				} catch {
					// Raced another taker — loop and retry the exclusive create.
				}
				continue;
			}
		}

		if (Date.now() > deadline) {
			// Gave up waiting on a lock that is still held by a live process.
			// Running our own build independently reproduces the original race
			// for this one pair of processes, but a slow-yet-successful
			// concurrent build is a far better failure mode than hanging the
			// caller's test run forever.
			return { lockPath, doneMarkerPath, acquired: false, recentlyBuilt: false, ownerNonce: null };
		}

		sleep(pollMs);
	}
}

/**
 * Releases a lock this process acquired. No-op when `lock.acquired` is
 * `false` (this process never owned it), and — critically — also a
 * no-op when the lock file on disk no longer carries this
 * acquisition's nonce: that means the lock was taken over and now
 * belongs to somebody else's in-flight build. Deleting it there would
 * admit a third process while the second is still running the command.
 *
 * @public
 */
export function releaseRunScriptLock(lock: RunScriptLock): void {
	if (!lock.acquired || lock.ownerNonce === null) return;
	const owner = readLockOwner(lock.lockPath);
	// Missing/corrupt record: already gone, or now owned by a writer we
	// cannot identify. Either way it is not ours to delete.
	if (owner === null || owner.nonce !== lock.ownerNonce) return;
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
