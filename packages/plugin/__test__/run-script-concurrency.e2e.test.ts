/**
 * Real concurrency proof for issue #191, sub-item B.
 *
 * `run-script-lock.test.ts` covers the settings `runScript` hands
 * `@effected/commands`' `RunOnce`; the lock protocol is the kit's. This
 * spawns real Node child processes that call the *built*
 * `AgentPlugin.runScript(...)`: two racing the same workspace + command
 * at (as close to) the same instant run it exactly once, a sequential
 * re-run is not skipped, a chatty build is not killed by a buffer limit,
 * and a failing build prints its captured output and exits non-zero.
 *
 * `.e2e.test.ts`: two real child-process spawns plus a deliberate
 * ~250ms race window are far outside plain `.test.ts`'s 5s unit
 * timeout — see `bin-crash-resilience.e2e.test.ts` for the sibling
 * subprocess-spawn convention.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pluginIndex = resolve(here, "..", "dist", "dev", "pkg", "index.js");

const baseEnv: Record<string, string> = Object.fromEntries(
	Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

let workDir: string;

afterEach(() => {
	if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function spawnRunner(
	runnerPath: string,
	env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolvePromise) => {
		const child = spawn("node", [runnerPath], { env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
	});
}

/** A runner script calling the built `runScript` with the command in `VA_COMMAND` (a JSON argv when `VA_ARGV` is set). */
function writeRunner(dir: string): string {
	const runnerPath = join(dir, "runner.mjs");
	writeFileSync(
		runnerPath,
		[
			`import { AgentPlugin } from ${JSON.stringify(pluginIndex)};`,
			"const command = process.env.VA_ARGV ? JSON.parse(process.env.VA_ARGV) : process.env.VA_COMMAND;",
			"AgentPlugin.runScript(command);",
			"",
		].join("\n"),
	);
	return runnerPath;
}

/** A "build" that bumps a counter file, so a test can count how often it ran. */
function writeCountingBuild(dir: string): string {
	const buildScriptPath = join(dir, "count.cjs");
	writeFileSync(
		buildScriptPath,
		[
			'const fs = require("node:fs");',
			"const p = process.env.VA_COUNTER_FILE;",
			'const n = (fs.existsSync(p) ? Number.parseInt(fs.readFileSync(p, "utf8") || "0", 10) : 0) + 1;',
			"fs.writeFileSync(p, String(n));",
			"",
		].join("\n"),
	);
	return buildScriptPath;
}

const fastLockEnv = {
	VITEST_AGENT_RUNSCRIPT_LOCK_STALE_MS: "60000",
	VITEST_AGENT_RUNSCRIPT_LOCK_WAIT_TIMEOUT_MS: "10000",
	VITEST_AGENT_RUNSCRIPT_LOCK_POLL_MS: "20",
};

describe("AgentPlugin.runScript concurrency", () => {
	it("runs the underlying command exactly once across two concurrent processes racing the same workspace + command", {
		timeout: 30_000,
	}, async () => {
		workDir = mkdtempSync(join(tmpdir(), "va-run-script-concurrency-"));
		const counterFile = join(workDir, "counter.txt");
		const runnerPath = join(workDir, "runner.mjs");
		const buildScriptPath = join(workDir, "build.cjs");

		// The raced "build": increments a shared counter file and busy-waits
		// ~250ms so both processes have a real window to race in. A separate
		// script file (instead of `node -e "..."`) sidesteps shell-quoting
		// entirely — a string command runs through `/bin/sh -c`.
		writeFileSync(
			buildScriptPath,
			[
				'const fs = require("node:fs");',
				"const p = process.env.VA_COUNTER_FILE;",
				'const n = (fs.existsSync(p) ? Number.parseInt(fs.readFileSync(p, "utf8") || "0", 10) : 0) + 1;',
				"fs.writeFileSync(p, String(n));",
				"const start = Date.now();",
				"while (Date.now() - start < 250) { /* busy-wait: real race window */ }",
				"",
			].join("\n"),
		);
		const command = `node ${JSON.stringify(buildScriptPath)}`;

		writeRunner(workDir);

		const sharedEnv: Record<string, string> = {
			...baseEnv,
			VA_COMMAND: command,
			VA_COUNTER_FILE: counterFile,
			// Shared lock-dir key space for both processes.
			XDG_DATA_HOME: workDir,
			// Fast overrides so the test doesn't wait out production-sized
			// timeouts (issue #191). No BUILT_RECENTLY opt-in: the waiter
			// trusts the owner it watched, not a sequential marker.
			...fastLockEnv,
		};

		const [a, b] = await Promise.all([spawnRunner(runnerPath, sharedEnv), spawnRunner(runnerPath, sharedEnv)]);
		expect(a.code, `process A stderr: ${a.stderr}`).toBe(0);
		expect(b.code, `process B stderr: ${b.stderr}`).toBe(0);

		const count = Number(readFileSync(counterFile, "utf8"));
		expect(count).toBe(1);
	});

	// B1: the done marker used to be trusted for 30s across SEQUENTIAL runs,
	// so an edit followed by a re-run skipped the build.
	it("re-runs the command on a sequential second call rather than trusting the first run's marker", {
		timeout: 30_000,
	}, async () => {
		workDir = mkdtempSync(join(tmpdir(), "va-run-script-sequential-"));
		const counterFile = join(workDir, "counter.txt");
		const runnerPath = writeRunner(workDir);
		const env = {
			...baseEnv,
			...fastLockEnv,
			VA_COMMAND: `node ${JSON.stringify(writeCountingBuild(workDir))}`,
			VA_COUNTER_FILE: counterFile,
			XDG_DATA_HOME: workDir,
		};

		const first = await spawnRunner(runnerPath, env);
		const second = await spawnRunner(runnerPath, env);
		expect(first.code, first.stderr).toBe(0);
		expect(second.code, second.stderr).toBe(0);
		expect(Number(readFileSync(counterFile, "utf8"))).toBe(2);
	});

	it("runs an argv command with no shell", { timeout: 30_000 }, async () => {
		workDir = mkdtempSync(join(tmpdir(), "va-run-script-argv-"));
		const counterFile = join(workDir, "counter.txt");
		const result = await spawnRunner(writeRunner(workDir), {
			...baseEnv,
			...fastLockEnv,
			VA_ARGV: JSON.stringify([process.execPath, writeCountingBuild(workDir)]),
			VA_COUNTER_FILE: counterFile,
			XDG_DATA_HOME: workDir,
		});
		expect(result.code, result.stderr).toBe(0);
		expect(Number(readFileSync(counterFile, "utf8"))).toBe(1);
	});

	// B5: `execSync`'s 1 MiB maxBuffer used to ENOBUFS-kill a chatty but
	// successful build.
	it("survives a successful build that writes more than 1 MiB of output", { timeout: 30_000 }, async () => {
		workDir = mkdtempSync(join(tmpdir(), "va-run-script-chatty-"));
		const chatty = join(workDir, "chatty.cjs");
		writeFileSync(chatty, 'process.stdout.write("x".repeat(3 * 1024 * 1024));\n');
		const result = await spawnRunner(writeRunner(workDir), {
			...baseEnv,
			...fastLockEnv,
			VA_COMMAND: `node ${JSON.stringify(chatty)}`,
			XDG_DATA_HOME: workDir,
		});
		expect(result.code, result.stderr).toBe(0);
		// Success stays silent: none of the build's output reaches the caller.
		expect(result.stdout).toBe("");
	});

	it("prints a failing build's captured output and exits non-zero", { timeout: 30_000 }, async () => {
		workDir = mkdtempSync(join(tmpdir(), "va-run-script-failing-"));
		const failing = join(workDir, "failing.cjs");
		writeFileSync(
			failing,
			'process.stdout.write("build-out-marker\\n"); process.stderr.write("build-err-marker\\n"); process.exit(3);\n',
		);
		const result = await spawnRunner(writeRunner(workDir), {
			...baseEnv,
			...fastLockEnv,
			VA_COMMAND: `node ${JSON.stringify(failing)}`,
			XDG_DATA_HOME: workDir,
		});
		expect(result.code).not.toBe(0);
		expect(result.stdout).toContain("build-out-marker");
		expect(result.stderr).toContain("build-err-marker");
	});
});
