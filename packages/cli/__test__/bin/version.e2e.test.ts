/**
 * End-to-end regression guard for `--version`.
 *
 * `bin.ts` is a thin shim over `main.ts`, which passes `CURRENT_CLI_VERSION`
 * (a build-time literal read from `package.json#version`) into
 * `Command.run`. This spawns the built bin and asserts the printed version
 * matches the package manifest rather than a hard-coded placeholder.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };

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

describe("vitest-agent CLI --version", () => {
	it("should report the real package version, not a placeholder", () => {
		const result = runBin(["--version"]);
		const output = result.stdout + result.stderr;

		expect(result.status).toBe(0);
		expect(output).toContain(packageJson.version);
	});
});
