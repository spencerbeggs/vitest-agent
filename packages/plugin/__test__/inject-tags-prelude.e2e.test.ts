import { execSync } from "node:child_process";
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
	let output: string;
	try {
		output = execSync(`node ${VITEST_BIN} run --reporter=json --no-color ${extraArgs.join(" ")}`, {
			cwd: FIXTURE_DIR,
			encoding: "utf8",
			env: { ...process.env, CI: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (err: unknown) {
		// execSync throws on non-zero exit; the JSON still lands on stdout.
		const e = err as { stdout?: string; stderr?: string };
		output = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
	}
	const line = output.split("\n").find((l) => l.trim().startsWith("{") && l.includes('"testResults"'));
	if (!line) throw new Error(`no JSON reporter output in:\n${output}`);
	return (JSON.parse(line) as { testResults: JsonFileResult[] }).testResults;
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
