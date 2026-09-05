/**
 * Regression guard for issue #363: `agent record tdd-artifact` must accept
 * an explicit `--suite vitest|bats` flag (default `vitest`) so the
 * post-tool-use hook can mark a bats-recorded artifact distinctly from a
 * vitest one.
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

describe("agent record tdd-artifact --suite flag", () => {
	it("advertises --suite on --help", () => {
		const result = runBin(["agent", "record", "tdd-artifact", "--help"]);
		const output = result.stdout + result.stderr;

		expect(result.status).toBe(0);
		expect(output).toContain("--suite");
	});
});
