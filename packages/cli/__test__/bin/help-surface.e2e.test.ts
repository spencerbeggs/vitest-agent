/**
 * Regression guard for the 2.0 CLI command surface.
 *
 * The top-level tree is exactly `doctor`, `db`, and `agent`. The six
 * reporting commands and the old `cache` group are gone for good; this
 * test fails if any of them is quietly re-introduced. It also confirms
 * the `agent` group renders its warning header, and pins the stream
 * contract: an explicit `--help` prints help on stdout (exit 0), while a
 * usage error prints help and the parse errors on stderr and leaves stdout
 * EMPTY (exit 64) — hooks pipe `agent *` stdout into jq.
 */

import { describe, expect, it } from "vitest";
import { runCli } from "../utils/cli-test.js";

const REMOVED_COMMANDS = ["status", "overview", "show", "history", "trends", "coverage", "cache", "_internal"];

describe("vitest-agent CLI surface", () => {
	it("should list doctor, db, and agent at the top level", async () => {
		const result = await runCli(["--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("USAGE");
		expect(result.stdout).toContain("doctor");
		expect(result.stdout).toContain("db");
		expect(result.stdout).toContain("agent");
	});

	it("should render the warning header on agent --help", async () => {
		const result = await runCli(["agent", "--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Commands intended for agents and hook scripts");
	});

	for (const removed of REMOVED_COMMANDS) {
		it(`should reject the removed command: ${removed}`, async () => {
			const result = await runCli([removed]);

			// Then: the usage exit code (BSD EX_USAGE, @effected/cli's default),
			// and the parser's complaint on stderr
			expect(result.exitCode).toBe(64);
			expect(result.stderr).toContain("Unknown subcommand");
			// And: help rides stderr beside the error; stdout stays empty
			expect(result.stderr).toContain("USAGE");
			expect(result.stdout).toBe("");
		});
	}

	it("should keep stdout empty on an unknown flag to an agent subcommand", async () => {
		const result = await runCli(["agent", "triage", "--no-such-flag"]);

		expect(result.exitCode).toBe(64);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toBe("");
	});

	it("should exit 64 with stdout empty on an invalid --audience value", async () => {
		const result = await runCli(["--audience", "nope", "doctor"]);

		expect(result.exitCode).toBe(64);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("nope");
	});

	it("should exit 64 when more than one audience flag is given", async () => {
		const result = await runCli(["--agent", "--human", "doctor"]);

		expect(result.exitCode).toBe(64);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("Give at most one of --audience, --human, --agent, --ci");
	});

	it("should accept one audience flag before or after the subcommand", async () => {
		for (const args of [
			["--agent", "db", "path"],
			["db", "path", "--ci"],
		]) {
			const result = await runCli(args);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toMatch(/data\.db\n$/);
			expect(result.stderr).toBe("");
		}
	});

	it("should keep diagnostics on stderr as NDJSON and stdout parseable under VITEST_REPORTER_LOG_LEVEL", async () => {
		const result = await runCli(["--agent", "doctor", "--format", "json"], {
			env: { VITEST_REPORTER_LOG_LEVEL: "debug" },
		});

		// stdout is the command's JSON result only
		expect(() => JSON.parse(result.stdout)).not.toThrow();
		// stderr carries the engine's debug records, one JSON object per line
		const lines = result.stderr
			.trimEnd()
			.split("\n")
			.filter((line) => line.length > 0);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});
});
