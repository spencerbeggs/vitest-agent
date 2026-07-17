/**
 * Regression guard for the 2.0 CLI command surface.
 *
 * The top-level tree is exactly `doctor`, `db`, and `agent`. The six
 * reporting commands and the old `cache` group are gone for good; this
 * test fails if any of them is quietly re-introduced. It also confirms
 * the `agent` group renders its warning header.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = resolve(__dirname, "..", "..", "dist", "dev", "pkg", "bin", "vitest-agent.js");

interface SpawnResult {
	stdout: string;
	stderr: string;
	status: number | null;
}

const runBin = (args: string[]): SpawnResult => {
	const result = spawnSync("node", [BIN, ...args], { encoding: "utf-8" });
	return {
		stdout: typeof result.stdout === "string" ? result.stdout : "",
		stderr: typeof result.stderr === "string" ? result.stderr : "",
		status: result.status,
	};
};

const REMOVED_COMMANDS = ["status", "overview", "show", "history", "trends", "coverage", "cache", "_internal"];

describe("vitest-agent CLI surface", () => {
	it("should list doctor, db, and agent at the top level", () => {
		const result = runBin(["--help"]);
		const output = result.stdout + result.stderr;

		expect(result.status).toBe(0);
		expect(output).toContain("doctor");
		expect(output).toContain("db");
		expect(output).toContain("agent");
	});

	it("should render the warning header on agent --help", () => {
		const result = runBin(["agent", "--help"]);
		const output = result.stdout + result.stderr;

		expect(result.status).toBe(0);
		expect(output).toContain("Commands intended for agents and hook scripts");
	});

	for (const removed of REMOVED_COMMANDS) {
		it(`should reject the removed command: ${removed}`, () => {
			const result = runBin([removed]);

			// Then: non-zero exit, the parser reports an unknown subcommand
			expect(result.status).not.toBe(0);
			expect(result.stdout + result.stderr).toContain("Unknown subcommand");
		});
	}
});
