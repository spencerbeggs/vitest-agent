import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "fixtures", "tag-prelude-project");
const WORKSPACE_ROOT = join(HERE, "..", "..", "..");
const VITEST_BIN = join(WORKSPACE_ROOT, "node_modules/vitest/vitest.mjs");

interface JsonAssertion {
	status: string;
	fullName: string;
}
interface JsonFileResult {
	name: string;
	assertionResults: JsonAssertion[];
}

function runFixture(extraArgs: string[]): JsonFileResult[] {
	const outDir = mkdtempSync(join(tmpdir(), "vitest-agent-json-"));
	const outputFile = join(outDir, "report.json");
	try {
		execFileSync(
			"node",
			[VITEST_BIN, "run", "--reporter=json", `--outputFile=${outputFile}`, "--no-color", ...extraArgs],
			{
				cwd: FIXTURE_DIR,
				encoding: "utf8",
				env: { ...process.env, CI: "1" },
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
	} catch {
		// execFileSync throws on non-zero exit; the JSON file is still written.
	}
	if (!existsSync(outputFile)) {
		throw new Error(`no JSON reporter output at ${outputFile}`);
	}
	try {
		return (JSON.parse(readFileSync(outputFile, "utf8")) as { testResults: JsonFileResult[] }).testResults;
	} finally {
		rmSync(outDir, { recursive: true, force: true });
	}
}

const passed = (results: JsonFileResult[]): string[] =>
	results.flatMap((r) => r.assertionResults.filter((a) => a.status === "passed").map((a) => a.fullName));

describe("file-level tag prelude in a real vitest run (issue #133)", () => {
	it("all declaration forms collect, pass, and inherit the injected tag", { timeout: 120_000 }, () => {
		// No filter: all five forms must pass — proving the wrapper tester's
		// (name, self, timeout) signature is no longer corrupted.
		const all = passed(runFixture([]));
		expect(all).toHaveLength(5);

		// Filtering on the injected tag must select ALL tests, including the
		// one that declares its own tags (runner-level union), the wrapper
		// tester, the describe-nested test, and the timeout-arg test the old
		// per-call injection could not reach.
		const unitTagged = passed(runFixture(["--tags-filter", "unit"]));
		expect(unitTagged).toHaveLength(5);
	});

	it("user-declared tags coexist with the injected tag", { timeout: 120_000 }, () => {
		const customTagged = passed(runFixture(["--tags-filter", "custom"]));
		expect(customTagged).toEqual(["test with explicit user tags"]);
	});
});
