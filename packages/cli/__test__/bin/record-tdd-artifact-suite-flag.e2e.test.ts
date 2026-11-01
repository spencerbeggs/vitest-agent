/**
 * Regression guard for issue #363: `agent record tdd-artifact` must accept
 * an explicit `--suite vitest|bats` flag (default `vitest`) so the
 * post-tool-use hook can mark a bats-recorded artifact distinctly from a
 * vitest one.
 */

import { describe, expect, it } from "vitest";
import { runCli } from "../utils/cli-test.js";

describe("agent record tdd-artifact --suite flag", () => {
	it("advertises --suite on --help", async () => {
		const result = await runCli(["agent", "record", "tdd-artifact", "--help"]);
		const output = result.stdout + result.stderr;

		expect(result.exitCode).toBe(0);
		expect(output).toContain("--suite");
	});
});
