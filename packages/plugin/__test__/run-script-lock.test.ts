/**
 * The settings `AgentPlugin.runScript` hands `@effected/commands`' `RunOnce`
 * (issue #191). The lock protocol itself is the kit's and is pinned by its own
 * suite; what is ours is the key (the command's cwd plus the command, hashed), the
 * directory, the env-tuned timings, and the shell argv a string command runs
 * as. Real concurrency lives in `run-script-concurrency.e2e.test.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	parseLockTimingOverride,
	resolveRunScriptLockDir,
	runScriptLockKey,
	runScriptOptions,
	shellCommand,
} from "../src/utils/run-script-lock.js";

describe("resolveRunScriptLockDir", () => {
	it("lives under XDG_DATA_HOME when set", () => {
		const dir = resolveRunScriptLockDir({ XDG_DATA_HOME: "/xdg-home" } as NodeJS.ProcessEnv, "/home/user");
		expect(dir).toBe(join("/xdg-home", "vitest-agent", "runscript-locks"));
	});

	it("falls back to ~/.local/share when XDG_DATA_HOME is unset or empty", () => {
		const expected = join("/home/user", ".local", "share", "vitest-agent", "runscript-locks");
		expect(resolveRunScriptLockDir({} as NodeJS.ProcessEnv, "/home/user")).toBe(expected);
		expect(resolveRunScriptLockDir({ XDG_DATA_HOME: "" } as NodeJS.ProcessEnv, "/home/user")).toBe(expected);
	});
});

describe("runScriptLockKey", () => {
	it("is a RunOnce-legal key: letters, digits, '.', '_' and '-', at most 128 characters", () => {
		const key = runScriptLockKey("/a/workspace with spaces", "pnpm turbo run build:dev && echo 'done'");
		expect(key).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
	});

	it("is stable for one root and command", () => {
		expect(runScriptLockKey("/ws", "pnpm build")).toBe(runScriptLockKey("/ws", "pnpm build"));
	});

	it("differs by command, by root, and between a string and the argv form of the same words", () => {
		const base = runScriptLockKey("/ws", "pnpm build");
		expect(runScriptLockKey("/ws", "pnpm build:a")).not.toBe(base);
		expect(runScriptLockKey("/other", "pnpm build")).not.toBe(base);
		expect(runScriptLockKey("/ws", ["pnpm", "build"])).not.toBe(base);
	});

	it("does not collide two argv commands whose joined words match", () => {
		expect(runScriptLockKey("/ws", ["a b", "c"])).not.toBe(runScriptLockKey("/ws", ["a", "b c"]));
	});
});

describe("runScriptOptions", () => {
	let workspace: string;

	beforeEach(() => {
		workspace = mkdtempSync(join(tmpdir(), "va-run-script-options-"));
		writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "ws", workspaces: ["packages/*"] }));
		mkdirSync(join(workspace, "packages", "a"), { recursive: true });
		writeFileSync(join(workspace, "packages", "a", "package.json"), JSON.stringify({ name: "a" }));
	});

	afterEach(() => {
		rmSync(workspace, { recursive: true, force: true });
	});

	// The command runs in the caller's cwd, so the key must name that
	// directory: a package's `pnpm build` and the root's are different builds,
	// and a waiter that shared the root's lock would skip its own.
	it("keys on the directory the command runs in, so a package cwd and the root cwd never share a lock", () => {
		const env = {} as NodeJS.ProcessEnv;
		const fromRoot = runScriptOptions("pnpm build", workspace, env);
		const fromPackage = runScriptOptions("pnpm build", join(workspace, "packages", "a"), env);
		expect(fromPackage.key).not.toBe(fromRoot.key);
		expect(fromRoot.key).toBe(runScriptLockKey(workspace, "pnpm build"));
		expect(fromPackage.key).toBe(runScriptLockKey(join(workspace, "packages", "a"), "pnpm build"));
	});

	it("leaves every timing to the RunOnce default, and trusts no sequential run, when no override is set", () => {
		const options = runScriptOptions("pnpm build", workspace, { XDG_DATA_HOME: "/x" } as NodeJS.ProcessEnv);
		expect(options).toEqual({
			key: runScriptLockKey(workspace, "pnpm build"),
			dir: join("/x", "vitest-agent", "runscript-locks"),
		});
	});

	it("maps each VITEST_AGENT_RUNSCRIPT_* override onto its RunOnce option", () => {
		const options = runScriptOptions("pnpm build", workspace, {
			VITEST_AGENT_RUNSCRIPT_LOCK_STALE_MS: "1000",
			VITEST_AGENT_RUNSCRIPT_LOCK_WAIT_TIMEOUT_MS: "2000",
			VITEST_AGENT_RUNSCRIPT_LOCK_POLL_MS: "20",
			VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS: "3000",
		} as NodeJS.ProcessEnv);
		expect(options).toMatchObject({ staleMs: 1000, waitTimeoutMs: 2000, pollMs: 20, trustSequentialMs: 3000 });
	});

	it("drops a poll override below RunOnce's 10ms floor rather than handing it a timing it throws on", () => {
		const options = runScriptOptions("pnpm build", workspace, {
			VITEST_AGENT_RUNSCRIPT_LOCK_POLL_MS: "5",
		} as NodeJS.ProcessEnv);
		expect(options).not.toHaveProperty("pollMs");
	});
});

describe("parseLockTimingOverride", () => {
	it("answers undefined when the env var is unset", () => {
		expect(parseLockTimingOverride(undefined)).toBeUndefined();
	});

	it.each(["200ms", "1e3", "1.5", "+1", "", "   ", "abc"])("rejects the non-integer override %j", (raw) => {
		expect(parseLockTimingOverride(raw)).toBeUndefined();
	});

	it("rejects negative and zero overrides", () => {
		expect(parseLockTimingOverride("-1")).toBeUndefined();
		expect(parseLockTimingOverride("0")).toBeUndefined();
	});

	it("enforces the minimum it is given", () => {
		expect(parseLockTimingOverride("9", 10)).toBeUndefined();
		expect(parseLockTimingOverride("10", 10)).toBe(10);
	});

	it("accepts a whole positive integer, trimming surrounding whitespace", () => {
		expect(parseLockTimingOverride("60000")).toBe(60_000);
		expect(parseLockTimingOverride(" 20 ", 10)).toBe(20);
	});
});

describe("shellCommand", () => {
	it("runs a string command through /bin/sh -c on POSIX", () => {
		expect(shellCommand("pnpm build && echo ok", "linux", {} as NodeJS.ProcessEnv)).toEqual({
			argv: ["/bin/sh", "-c", "pnpm build && echo ok"],
		});
	});

	it("runs a string command as Node's shell option does on Windows, defaulting to cmd.exe", () => {
		expect(
			shellCommand('pnpm build --filter "a b"', "win32", { ComSpec: "C:\\Windows\\cmd.exe" } as NodeJS.ProcessEnv),
		).toEqual({
			argv: ["C:\\Windows\\cmd.exe", "/d", "/s", "/c", '"pnpm build --filter "a b""'],
			windowsVerbatimArguments: true,
		});
		expect(shellCommand("pnpm build", "win32", {} as NodeJS.ProcessEnv).argv[0]).toBe("cmd.exe");
	});
});
