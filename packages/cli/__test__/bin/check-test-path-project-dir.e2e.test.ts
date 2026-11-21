/**
 * `agent check-test-path` classifies against the project directory `main.ts`
 * resolves (`ProjectDir`, from `resolveProjectDir`), the same one every other
 * command uses: `VITEST_AGENT_PROJECT_DIR`, then
 * `VITEST_AGENT_REPORTER_PROJECT_DIR`, then `CLAUDE_PROJECT_DIR`, then the
 * working directory, with a blank or unsubstituted `${...}` value read as unset.
 *
 * Every case runs the CLI from a directory outside the workspace and passes a
 * path relative to the project, so a verdict is only possible when the project
 * directory came from the environment. The command used to read
 * `VITEST_AGENT_PROJECT_DIR ?? cwd`: a blank value anchored it on the working
 * directory and it rendered no verdict (exit 1).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "../utils/cli-test.js";
import { openSession } from "../utils/cli-test.js";

let session: CliSession;
let fixtureRoot: string;
let outsideDir: string;

/** A test file outside `src/` and `__test__/`, so the default strategy rules it invalid. */
const MISPLACED = join("packages", "foo", "lib", "a.test.ts");

beforeEach(async () => {
	session = await openSession();
	fixtureRoot = join(session.sandbox.root, "fixture");
	outsideDir = join(session.sandbox.root, "elsewhere");
	mkdirSync(join(fixtureRoot, "packages", "foo", "src"), { recursive: true });
	mkdirSync(outsideDir);
	writeFileSync(join(fixtureRoot, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
	writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ name: "fixture-root", private: true }));
	writeFileSync(
		join(fixtureRoot, "packages", "foo", "package.json"),
		JSON.stringify({ name: "foo", version: "0.0.0" }),
	);
	writeFileSync(join(fixtureRoot, "vitest.config.ts"), "export default {};\n");
});

afterEach(() => session.close());

const checkFromOutside = (env: Readonly<Record<string, string>>) =>
	session.run(["agent", "check-test-path", MISPLACED], { cwd: outsideDir, env });

describe("agent check-test-path project directory", () => {
	it("reads a blank VITEST_AGENT_PROJECT_DIR as unset and falls back to CLAUDE_PROJECT_DIR", async () => {
		const result = await checkFromOutside({ VITEST_AGENT_PROJECT_DIR: "", CLAUDE_PROJECT_DIR: fixtureRoot });

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "invalid" });
	});

	// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder is the case under test
	it("reads an unsubstituted ${...} placeholder as unset", async () => {
		const result = await checkFromOutside({
			// biome-ignore lint/suspicious/noTemplateCurlyInString: an unsubstituted hook placeholder, verbatim
			VITEST_AGENT_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}",
			CLAUDE_PROJECT_DIR: fixtureRoot,
		});

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "invalid" });
	});

	it("uses VITEST_AGENT_REPORTER_PROJECT_DIR when VITEST_AGENT_PROJECT_DIR is absent", async () => {
		const result = await checkFromOutside({ VITEST_AGENT_REPORTER_PROJECT_DIR: fixtureRoot });

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "invalid" });
	});

	it("renders no verdict when nothing names the project and the working directory is outside it", async () => {
		const result = await checkFromOutside({});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
	});
});
