/**
 * A failure while building the platform layer (here: the XDG data directory
 * cannot be created) is reported by `CliRuntime.main` as one line on stderr
 * with the fallback exit code, never a stack trace and never on stdout —
 * hooks parse `agent *` stdout with jq.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../utils/cli-test.js";

describe("vitest-agent CLI failure reporting", () => {
	it("renders a platform layer-build failure as one stderr line and exits 1", async () => {
		const result = await runCli(["db", "path"], {
			setup: (sandbox) => {
				writeFileSync(join(sandbox.root, "package.json"), JSON.stringify({ name: "failure-fixture" }));
				// A regular file where the data directory's parent should be: mkdir fails.
				writeFileSync(join(sandbox.root, "blocker"), "");
				return undefined;
			},
			env: { XDG_DATA_HOME: "/dev/null/blocked" },
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		const lines = result.stderr.trimEnd().split("\n");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/^vitest-agent: \w+Error: /);
	});
});
