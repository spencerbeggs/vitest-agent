/**
 * Issue #544 review: in `stream` mode the live view is still mounted when
 * `onTestRunEnd` writes the stderr failure summary, so a raw stderr write
 * would strand its frames. The summary goes line by line through the
 * reporters' `printStrayLine` seam instead; `agent` mode keeps writing
 * `process.stderr` directly.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentReporterConstructorOptions } from "../src/reporter.js";
import { AgentReporter } from "../src/reporter.js";

const failingModule = (): VitestTestModule => {
	const test: VitestTestCase = {
		type: "test",
		name: "adds numbers",
		fullName: "adds numbers",
		tags: [],
		result: () => ({ state: "failed", errors: [{ message: "expected 3 to be 4" }] }),
		diagnostic: () => ({ duration: 1, flaky: false, slow: false }),
	};
	return {
		type: "module",
		moduleId: "/abs/src/math.test.ts",
		relativeModuleId: "src/math.test.ts",
		project: { name: "" },
		state: () => "failed",
		children: {
			*allTests() {
				yield test;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 1 }),
		errors: () => [],
	};
};

let tmp: string;
let stderr: string[];
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "vitest-agent-summary-route-"));
	stderr = [];
	vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
		stderr.push(String(chunk));
		return true;
	}) as typeof process.stderr.write);
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(tmp, { recursive: true, force: true });
});

const run = async (consoleMode: NonNullable<AgentReporterConstructorOptions["consoleMode"]>, takes = true) => {
	const printed: Array<[string, string]> = [];
	const reporter = new AgentReporter({
		cacheDir: tmp,
		consoleMode,
		reporter: () => ({
			render: () => [],
			printStrayLine: (stream: "stdout" | "stderr", line: string) => {
				printed.push([stream, line]);
				return takes;
			},
		}),
	});
	await reporter.onInit({});
	reporter.onTestRunStart([]);
	await reporter.onTestRunEnd([failingModule()], [], "failed");
	return printed;
};

describe("stderr failure summary routing (#544)", () => {
	it("prints the stream-mode summary line by line through printStrayLine, not process.stderr", async () => {
		const printed = await run("stream");
		const lines = printed.map(([, line]) => line);
		expect(printed.length).toBeGreaterThan(1);
		expect(printed.every(([stream]) => stream === "stderr")).toBe(true);
		expect(lines.some((line) => line.includes("adds numbers"))).toBe(true);
		expect(lines.every((line) => !line.includes("\n"))).toBe(true);
		expect(stderr.join("")).not.toContain("adds numbers");
	});

	it("falls back to process.stderr for lines no printer takes", async () => {
		const printed = await run("stream", false);
		expect(printed.length).toBeGreaterThan(0);
		expect(stderr.join("")).toContain("adds numbers");
	});

	it("keeps writing the agent-mode summary to process.stderr", async () => {
		const printed = await run("agent");
		expect(printed).toEqual([]);
		expect(stderr.join("")).toContain("adds numbers");
	});
});
