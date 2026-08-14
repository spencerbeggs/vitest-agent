/**
 * Real concurrency proof for issue #191, sub-item B.
 *
 * `run-script-lock.test.ts` covers the lock state machine with real
 * temp directories and backdated mtimes but a single (synchronous, one
 * thread) test process — it cannot exercise genuine concurrent
 * acquisition. This spawns two real Node child processes that both
 * call the *built* `AgentPlugin.runScript(...)` against the same
 * workspace + command at (as close to) the same instant, and asserts
 * the underlying command ran exactly once.
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
): Promise<{ code: number | null; stderr: string }> {
	return new Promise((resolvePromise) => {
		const child = spawn("node", [runnerPath], { env, stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("close", (code) => resolvePromise({ code, stderr }));
	});
}

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
		// entirely — `runScript` shells out via `execSync`.
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

		writeFileSync(
			runnerPath,
			`import { AgentPlugin } from ${JSON.stringify(pluginIndex)};\nAgentPlugin.runScript(process.env.VA_COMMAND);\n`,
		);

		const sharedEnv: Record<string, string> = {
			...baseEnv,
			VA_COMMAND: command,
			VA_COUNTER_FILE: counterFile,
			// Shared lock-dir key space for both processes.
			XDG_DATA_HOME: workDir,
			// Fast overrides so the test doesn't wait out production-sized
			// timeouts (issue #191).
			VITEST_AGENT_RUNSCRIPT_LOCK_STALE_MS: "60000",
			VITEST_AGENT_RUNSCRIPT_LOCK_WAIT_TIMEOUT_MS: "10000",
			VITEST_AGENT_RUNSCRIPT_LOCK_POLL_MS: "20",
			VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS: "10000",
		};

		const [a, b] = await Promise.all([spawnRunner(runnerPath, sharedEnv), spawnRunner(runnerPath, sharedEnv)]);
		expect(a.code, `process A stderr: ${a.stderr}`).toBe(0);
		expect(b.code, `process B stderr: ${b.stderr}`).toBe(0);

		const count = Number(readFileSync(counterFile, "utf8"));
		expect(count).toBe(1);
	});
});
