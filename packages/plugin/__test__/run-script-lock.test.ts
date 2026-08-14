/**
 * `run-script-lock.ts` (issue #191, sub-item B).
 *
 * `AgentPlugin.runScript` used to be a bare `execSync` with no advisory
 * lock — two concurrent `vitest` invocations in one checkout both ran
 * the `globalSetup` build and raced. These tests cover the pure
 * lock-directory resolution and the acquire/release/stale-takeover/
 * recently-built-skip state machine in isolation, using real temp
 * directories and backdated mtimes (`utimesSync`) instead of real
 * waiting, so the whole suite stays instant and deterministic. The
 * true concurrency proof — two real processes racing the same build —
 * lives in `run-script-concurrency.e2e.test.ts`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_LOCK_POLL_MS,
	DEFAULT_LOCK_STALE_MS,
	MIN_LOCK_POLL_MS,
	acquireRunScriptLock,
	markRunScriptDone,
	parseLockTimingOverride,
	releaseRunScriptLock,
	resolveRunScriptLockDir,
} from "../src/utils/run-script-lock.js";

// Lets one test make `writeSync` fail on the lock-file initialization write
// while every other test keeps the real implementation.
const fsControl = vi.hoisted(() => ({ failNextWriteSync: false }));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		writeSync: (...args: Parameters<typeof actual.writeSync>): number => {
			if (fsControl.failNextWriteSync) {
				fsControl.failNextWriteSync = false;
				throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
			}
			return actual.writeSync(...args);
		},
	};
});

/**
 * A pid that is guaranteed not to be running: spawn a trivial process
 * synchronously and reuse its pid once it has exited.
 */
function deadPid(): number {
	const result = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
	const pid = result.pid;
	expect(typeof pid).toBe("number");
	return pid as number;
}

/** Writes a lock file by hand with a chosen owner pid, backdated well past any test's staleMs. */
function writeBackdatedLock(lockPath: string, pid: number, nonce = "hand-written-nonce"): void {
	writeFileSync(lockPath, JSON.stringify({ pid, nonce, startedAt: new Date(0).toISOString() }));
	const longAgo = new Date(Date.now() - 600_000);
	utimesSync(lockPath, longAgo, longAgo);
}

describe("resolveRunScriptLockDir", () => {
	it("prefers XDG_DATA_HOME when set", () => {
		const dir = resolveRunScriptLockDir({ XDG_DATA_HOME: "/xdg-home" } as NodeJS.ProcessEnv, "/home/user");
		expect(dir).toBe(join("/xdg-home", "vitest-agent", "runscript-locks"));
	});

	it("falls back to a normalized location under the user's home directory when XDG_DATA_HOME is unset", () => {
		const dir = resolveRunScriptLockDir({} as NodeJS.ProcessEnv, "/home/user");
		expect(dir).toBe(join("/home/user", ".local", "share", "vitest-agent", "runscript-locks"));
	});
});

describe("acquireRunScriptLock / releaseRunScriptLock", () => {
	let lockDir: string;

	beforeEach(() => {
		lockDir = mkdtempSync(join(tmpdir(), "va-run-script-lock-"));
	});

	afterEach(() => {
		rmSync(lockDir, { recursive: true, force: true });
	});

	it("acquires immediately when no lock file exists, and release removes it", () => {
		const lock = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build", lockDir });
		expect(lock.acquired).toBe(true);
		expect(lock.recentlyBuilt).toBe(false);
		expect(existsSync(lock.lockPath)).toBe(true);

		releaseRunScriptLock(lock);
		expect(existsSync(lock.lockPath)).toBe(false);
	});

	it("takes over a lock older than staleMs whose recorded owner process is gone", () => {
		const probe = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build", lockDir });
		// Rewrite the lock as if a since-crashed process owned it, backdated
		// past staleMs, so the next acquire treats it as abandoned.
		writeBackdatedLock(probe.lockPath, deadPid());

		const second = acquireRunScriptLock({
			cwd: "/workspace",
			command: "pnpm build",
			lockDir,
			staleMs: 1_000,
			pollMs: 1,
			waitTimeoutMs: 5_000,
		});
		expect(second.acquired).toBe(true);
		expect(second.recentlyBuilt).toBe(false);
	});

	it("does not take over a lock older than staleMs while its recorded owner process is still alive", () => {
		// Given: a lock owned by a process that is provably running (this one),
		// backdated far past staleMs. mtime is never refreshed during a build,
		// so a slow-but-healthy build looks exactly like this.
		const probe = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build", lockDir });
		writeBackdatedLock(probe.lockPath, process.pid, "live-owner-nonce");

		// When: a second caller tries to acquire, with a wait timeout it will hit
		let sleeps = 0;
		const second = acquireRunScriptLock({
			cwd: "/workspace",
			command: "pnpm build",
			lockDir,
			staleMs: 1_000,
			pollMs: 1,
			waitTimeoutMs: 5,
			sleep: () => {
				sleeps += 1;
			},
		});

		// Then: it waited (and eventually fell through the escape valve) rather
		// than stealing a live owner's lock, and the live owner's file survives.
		expect(sleeps).toBeGreaterThan(0);
		expect(second.acquired).toBe(false);
		expect(second.recentlyBuilt).toBe(false);
		expect(existsSync(probe.lockPath)).toBe(true);
		expect(JSON.parse(readFileSync(probe.lockPath, "utf8")).nonce).toBe("live-owner-nonce");
	});

	it("falls back to the mtime-age rule when the lock file holds no readable owner record", () => {
		const probe = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build", lockDir });
		// Corrupt/truncated lock file (e.g. observed mid-write, or hand-edited):
		// there is no pid to probe, so age is all we have.
		writeFileSync(probe.lockPath, "{not json");
		const longAgo = new Date(Date.now() - 600_000);
		utimesSync(probe.lockPath, longAgo, longAgo);

		const second = acquireRunScriptLock({
			cwd: "/workspace",
			command: "pnpm build",
			lockDir,
			staleMs: 1_000,
			pollMs: 1,
			waitTimeoutMs: 5_000,
		});
		expect(second.acquired).toBe(true);
	});

	it("leaves the takeover owner's lock in place when the original owner releases after being taken over", () => {
		// Given: an original owner that acquired the lock normally...
		const original = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build", lockDir });
		expect(original.acquired).toBe(true);
		// ...whose process then died mid-build (same nonce, dead pid, backdated).
		writeBackdatedLock(original.lockPath, deadPid(), original.ownerNonce as string);

		// When: a second process takes the abandoned lock over...
		const takeover = acquireRunScriptLock({
			cwd: "/workspace",
			command: "pnpm build",
			lockDir,
			staleMs: 1_000,
			pollMs: 1,
			waitTimeoutMs: 5_000,
		});
		expect(takeover.acquired).toBe(true);
		// ...and the original owner's `finally` still runs its release.
		releaseRunScriptLock(original);

		// Then: the takeover owner still holds its lock — deleting it here would
		// admit a third process while the second is mid-build.
		expect(existsSync(takeover.lockPath)).toBe(true);
		expect(JSON.parse(readFileSync(takeover.lockPath, "utf8")).nonce).toBe(takeover.ownerNonce);

		releaseRunScriptLock(takeover);
		expect(existsSync(takeover.lockPath)).toBe(false);
	});

	it("removes the lock file it created when initializing the lock fails", () => {
		// Given: the write that stamps the owner record into a freshly created
		// lock file fails (disk full, EIO, ...).
		fsControl.failNextWriteSync = true;

		// When/Then: the error propagates, and the half-created lock file is not
		// left behind to stall every later caller.
		expect(() => acquireRunScriptLock({ cwd: "/workspace", command: "pnpm init-fail", lockDir })).toThrow(/ENOSPC/);
		fsControl.failNextWriteSync = false;

		// A later caller acquires immediately instead of waiting out an orphan.
		const after = acquireRunScriptLock({
			cwd: "/workspace",
			command: "pnpm init-fail",
			lockDir,
			pollMs: 1,
			waitTimeoutMs: 50,
		});
		expect(after.acquired).toBe(true);
	});

	it("reports recentlyBuilt once a fresh done-marker appears while polling an active lock", () => {
		const winner = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build", lockDir });
		expect(winner.acquired).toBe(true);

		// Simulate the winner finishing its build and writing the done
		// marker exactly while we're "waiting" — the injected sleep is
		// the point where a real concurrent process would make progress.
		let sleptOnce = false;
		const waiter = acquireRunScriptLock({
			cwd: "/workspace",
			command: "pnpm build",
			lockDir,
			staleMs: 60_000,
			waitTimeoutMs: 5_000,
			pollMs: 1,
			sleep: () => {
				if (!sleptOnce) {
					sleptOnce = true;
					markRunScriptDone(winner);
				}
			},
		});
		expect(sleptOnce).toBe(true);
		expect(waiter.acquired).toBe(false);
		expect(waiter.recentlyBuilt).toBe(true);
	});

	it("markRunScriptDone writes a done marker file that acquireRunScriptLock can see", () => {
		const lock = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build", lockDir });
		markRunScriptDone(lock);
		expect(existsSync(lock.doneMarkerPath)).toBe(true);
	});
});

describe("parseLockTimingOverride", () => {
	it("returns the fallback when the value is unset", () => {
		expect(parseLockTimingOverride(undefined, DEFAULT_LOCK_STALE_MS)).toBe(DEFAULT_LOCK_STALE_MS);
	});

	it.each([
		["200ms", "a unit suffix Number.parseInt would silently truncate"],
		["1e3", "exponent notation"],
		["1.5", "a fractional value"],
		["abc", "outright garbage"],
		["", "an empty value"],
		[" ", "whitespace only"],
	])("returns the fallback for %j (%s)", (raw) => {
		expect(parseLockTimingOverride(raw, DEFAULT_LOCK_STALE_MS)).toBe(DEFAULT_LOCK_STALE_MS);
	});

	it("returns the fallback for a negative value, which would otherwise make every lock instantly stale", () => {
		expect(parseLockTimingOverride("-1", DEFAULT_LOCK_STALE_MS)).toBe(DEFAULT_LOCK_STALE_MS);
	});

	it("returns the fallback for zero, which would otherwise make every lock instantly stale", () => {
		expect(parseLockTimingOverride("0", DEFAULT_LOCK_STALE_MS)).toBe(DEFAULT_LOCK_STALE_MS);
	});

	it("returns the fallback for a poll interval below the busy-spin floor", () => {
		expect(parseLockTimingOverride("0", DEFAULT_LOCK_POLL_MS, MIN_LOCK_POLL_MS)).toBe(DEFAULT_LOCK_POLL_MS);
		expect(parseLockTimingOverride("1", DEFAULT_LOCK_POLL_MS, MIN_LOCK_POLL_MS)).toBe(DEFAULT_LOCK_POLL_MS);
	});

	it("accepts a valid whole-millisecond value, including surrounding whitespace", () => {
		expect(parseLockTimingOverride("60000", DEFAULT_LOCK_STALE_MS)).toBe(60_000);
		expect(parseLockTimingOverride(" 20 ", DEFAULT_LOCK_POLL_MS, MIN_LOCK_POLL_MS)).toBe(20);
	});
});

// Guards against a future refactor accidentally sharing lock state
// across unrelated cwd/command pairs.
describe("lock keying", () => {
	let lockDir: string;

	beforeEach(() => {
		lockDir = mkdtempSync(join(tmpdir(), "va-run-script-lock-key-"));
	});

	afterEach(() => {
		rmSync(lockDir, { recursive: true, force: true });
	});

	it("uses distinct lock paths for different commands in the same workspace", () => {
		const a = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build:a", lockDir });
		const b = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build:b", lockDir });
		expect(a.lockPath).not.toBe(b.lockPath);
		releaseRunScriptLock(a);
		releaseRunScriptLock(b);
	});

	it("throws when the lock file cannot be created for a reason other than EEXIST", () => {
		// A lock "directory" path that collides with an existing plain file
		// makes mkdirSync/openSync fail for a non-EEXIST reason.
		const blockerPath = join(lockDir, "blocked");
		writeFileSync(blockerPath, "not a directory");
		expect(() =>
			acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build", lockDir: join(blockerPath, "nested") }),
		).toThrow();
	});
});
