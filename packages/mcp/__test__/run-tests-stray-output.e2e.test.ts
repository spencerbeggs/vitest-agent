/**
 * `run_tests` surfaces stray output (bytes a test's child process wrote
 * straight to the worker's stdout/stderr, past Vitest's console capture) on
 * `report.strayOutput`, read from the plugin's capture on the nested
 * Vitest's Logger, and none of it reaches this process's stdout, the MCP
 * server's JSON-RPC channel: the nested Vitest's Logger streams are the
 * server's null sink, and the plugin's capture forwards there.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { McpSession } from "../src/session.js";
import { test } from "./integration/utils/fixtures.js";
import { makeCaller } from "./utils/caller.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "stray-output-project");
let xdgDir: string;

beforeAll(() => {
	xdgDir = mkdtempSync(join(tmpdir(), "va-stray-xdg-"));
	process.env.XDG_DATA_HOME = xdgDir;
});

afterAll(() => {
	delete process.env.XDG_DATA_HOME;
	rmSync(xdgDir, { recursive: true, force: true });
});

describe("run_tests reports stray output and keeps it off the protocol stdout (e2e)", () => {
	test("a child process with inherited stdio surfaces as strayOutput", { timeout: 120_000 }, async ({ runtime }) => {
		const written: string[] = [];
		const stdoutWrite = process.stdout.write;
		const stderrWrite = process.stderr.write;
		const spy = (original: typeof process.stdout.write) =>
			function (this: NodeJS.WriteStream, ...args: unknown[]) {
				written.push(String(args[0]));
				return (original as (...a: unknown[]) => boolean).apply(this, args);
			} as typeof process.stdout.write;
		process.stdout.write = spy(stdoutWrite);
		process.stderr.write = spy(stderrWrite);
		let result: Awaited<ReturnType<ReturnType<typeof makeCaller>>>;
		try {
			const call = makeCaller(runtime, McpSession.layerTest({ cwd: fixtureDir }));
			result = await call("run_tests", {});
		} finally {
			process.stdout.write = stdoutWrite;
			process.stderr.write = stderrWrite;
		}

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		const stray = result.report.strayOutput;
		expect(stray).toMatchObject({ total: 2, stdout: 1, stderr: 1 });
		expect(stray?.samples).toEqual(
			expect.arrayContaining([
				{ stream: "stdout", text: "STRAY-STDOUT from child" },
				{ stream: "stderr", text: "STRAY-STDERR from child" },
			]),
		);
		expect(written.join("")).not.toContain("STRAY-");
	});
});
