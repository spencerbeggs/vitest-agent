/**
 * Stray output end to end: Vitest runs in-process (real config, real forks
 * pool, real worker) over a fixture whose test spawns a child with inherited
 * stdio that writes to stderr. Vitest's streams are this process's own
 * stdout/stderr, so the plugin treats them as the terminal. A custom reporter
 * stands in for a live view: it implements `printStrayLine`. The run must
 * report the line on `AgentReport.strayOutput`, hand it to the reporter, and
 * write none of it raw to the terminal.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReporterRenderInput } from "@vitest-agent/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { AgentPlugin } from "../src/plugin.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "stray-output-project");
const STRAY = "STRAY-LINE from child";

let xdgDir: string;
const previousXdg = process.env.XDG_DATA_HOME;
beforeAll(() => {
	xdgDir = mkdtempSync(join(tmpdir(), "va-plugin-stray-xdg-"));
	process.env.XDG_DATA_HOME = xdgDir;
});
afterAll(() => {
	if (previousXdg === undefined) delete process.env.XDG_DATA_HOME;
	else process.env.XDG_DATA_HOME = previousXdg;
	rmSync(xdgDir, { recursive: true, force: true });
});

/** Record every raw write to this process's stdout and stderr while `fn` runs. */
const recordingRawWrites = async <A>(fn: () => Promise<A>): Promise<{ value: A; raw: string }> => {
	const chunks: string[] = [];
	const stdoutWrite = process.stdout.write;
	const stderrWrite = process.stderr.write;
	const spy = (original: typeof process.stdout.write) =>
		function (this: NodeJS.WriteStream, ...args: unknown[]) {
			chunks.push(String(args[0]));
			return (original as (...a: unknown[]) => boolean).apply(this, args);
		} as typeof process.stdout.write;
	process.stdout.write = spy(stdoutWrite);
	process.stderr.write = spy(stderrWrite);
	try {
		return { value: await fn(), raw: chunks.join("") };
	} finally {
		process.stdout.write = stdoutWrite;
		process.stderr.write = stderrWrite;
	}
};

describe("stray output from a test's child process (e2e)", () => {
	it("is reported on strayOutput and printed through the reporter, never raw to the terminal", {
		timeout: 120_000,
	}, async () => {
		const renders: ReporterRenderInput[] = [];
		const printed: string[] = [];
		const plugin = AgentPlugin({
			discoverStrategy: false,
			console: { human: "silent", agent: "silent", ci: "silent" },
			reporter: () => ({
				render: (input) => {
					renders.push(input);
					return [];
				},
				printStrayLine: (stream, line) => {
					printed.push(`${stream}|${line}`);
					return true;
				},
			}),
		});

		const { raw } = await recordingRawWrites(async () => {
			const vitest = await createVitest(
				"test",
				{ root: FIXTURE_DIR, config: false, run: true, watch: false, pool: "forks", coverage: { enabled: false } },
				{ plugins: [plugin] },
				{ stdout: process.stdout, stderr: process.stderr },
			);
			try {
				await vitest.start();
			} finally {
				await vitest.close();
			}
		});

		expect(renders).toHaveLength(1);
		const stray = renders[0]?.reports[0]?.strayOutput;
		expect(stray).toMatchObject({ total: 1, stdout: 0, stderr: 1, samples: [{ stream: "stderr", text: STRAY }] });
		expect(printed).toEqual([`stderr|${STRAY}`]);
		expect(raw).not.toContain(STRAY);
	});
});
