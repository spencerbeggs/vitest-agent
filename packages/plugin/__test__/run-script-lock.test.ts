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

import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	acquireRunScriptLock,
	markRunScriptDone,
	releaseRunScriptLock,
	resolveRunScriptLockDir,
} from "../src/utils/run-script-lock.js";

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

	it("takes over a lock older than staleMs instead of waiting for it", () => {
		const first = acquireRunScriptLock({ cwd: "/workspace", command: "pnpm build", lockDir });
		// Backdate the lock file's mtime well past staleMs so the next
		// acquire treats it as abandoned rather than waiting it out.
		const longAgo = new Date(Date.now() - 60_000);
		utimesSync(first.lockPath, longAgo, longAgo);

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
