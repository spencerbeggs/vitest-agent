/**
 * Stderr failure summary end to end: Vitest runs in-process over a fixture
 * with one failing test, console mode `agent` (the plugin owns stdout). The
 * failure detail must also reach stderr, as the last lines written, so
 * `vitest doctor` (which tails a trial run's stderr) can show it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { AgentPlugin } from "../src/plugin.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "failure-summary-project");

let xdgDir: string;
const previousXdg = process.env.XDG_DATA_HOME;
beforeAll(() => {
	xdgDir = mkdtempSync(join(tmpdir(), "va-plugin-failsum-xdg-"));
	process.env.XDG_DATA_HOME = xdgDir;
});
afterAll(() => {
	if (previousXdg === undefined) delete process.env.XDG_DATA_HOME;
	else process.env.XDG_DATA_HOME = previousXdg;
	rmSync(xdgDir, { recursive: true, force: true });
});

describe("stderr failure summary (e2e)", () => {
	it("writes the failure to stderr in agent mode, within the last 15 lines", { timeout: 120_000 }, async () => {
		const err: string[] = [];
		const stderrWrite = process.stderr.write;
		const stdoutWrite = process.stdout.write;
		process.stderr.write = ((chunk: unknown) => {
			err.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		process.stdout.write = (() => true) as typeof process.stdout.write;
		try {
			const plugin = AgentPlugin({
				discoverStrategy: false,
				persist: false,
				console: { human: "agent", agent: "agent", ci: "ci-annotations" },
			});
			const vitest = await createVitest(
				"test",
				{ root: FIXTURE_DIR, config: false, run: true, watch: false, pool: "forks", coverage: { enabled: false } },
				{ plugins: [plugin] },
			);
			try {
				await vitest.start();
			} finally {
				await vitest.close();
			}
		} finally {
			process.stderr.write = stderrWrite;
			process.stdout.write = stdoutWrite;
		}
		const lines = err
			.join("")
			.split("\n")
			.filter((l) => l.length > 0);
		const tail = lines.slice(-15).join("\n");
		expect(tail).toContain("vitest-agent: 1 failed test");
		expect(tail).toContain("process.chdir() is not supported in workers");
	});
});
