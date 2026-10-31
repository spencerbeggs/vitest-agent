/**
 * End-to-end subprocess test for `agent check-test-path` failing open when
 * the workspace's Vitest config indicates a non-default `DiscoverStrategy`
 * (issue #230). Loading the consumer's config to determine the strategy
 * actually in force is out of scope for a hook hot path — instead the CLI
 * scans the config file's source text for lexical markers and fails open
 * (exit 1, no stdout) when one is present, or when the config cannot be read.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "../utils/cli-test.js";
import { openSession } from "../utils/cli-test.js";

let session: CliSession;
let fixtureRoot: string;

const runBin = (args: ReadonlyArray<string>, opts: { cwd: string }) =>
	session.run(args, { cwd: opts.cwd, env: { VITEST_AGENT_PROJECT_DIR: opts.cwd } });

beforeEach(async () => {
	session = await openSession();
	fixtureRoot = join(session.sandbox.root, "fixture");
	mkdirSync(join(fixtureRoot, "packages", "foo", "src"), { recursive: true });
	writeFileSync(join(fixtureRoot, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
	writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ name: "fixture-root", private: true }));
	writeFileSync(
		join(fixtureRoot, "packages", "foo", "package.json"),
		JSON.stringify({ name: "foo", version: "0.0.0" }),
	);
});

afterEach(() => session.close());

describe("agent check-test-path — non-default discover strategy fail-open", () => {
	it("exits 1 with empty stdout when the vitest config carries a discoverStrategy marker", async () => {
		writeFileSync(
			join(fixtureRoot, "vitest.config.ts"),
			`import { AgentPlugin } from "@vitest-agent/plugin";\nexport default { plugins: [AgentPlugin({ discoverStrategy: false })] };\n`,
		);
		const target = join(fixtureRoot, "packages", "foo", "lib", "a.test.ts");
		const result = await runBin(["agent", "check-test-path", target], { cwd: fixtureRoot });

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
	});

	it("still renders a verdict when the vitest config has no strategy markers", async () => {
		writeFileSync(
			join(fixtureRoot, "vitest.config.ts"),
			`import { AgentPlugin } from "@vitest-agent/plugin";\nexport default { plugins: [AgentPlugin({ console })] };\n`,
		);
		const target = join(fixtureRoot, "packages", "foo", "lib", "a.test.ts");
		const result = await runBin(["agent", "check-test-path", target], { cwd: fixtureRoot });

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "invalid" });
	});

	// The config lookup derives from sdk's VITEST_CONFIG_FILES, the names Vitest 5 loads.
	it("reads a vitest.config.cts, which Vitest 5 loads", async () => {
		writeFileSync(join(fixtureRoot, "vitest.config.cts"), "module.exports = {};\n");
		const target = join(fixtureRoot, "packages", "foo", "lib", "a.test.ts");
		const result = await runBin(["agent", "check-test-path", target], { cwd: fixtureRoot });

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "invalid" });
	});

	it("fails open on a lone vitest.workspace.ts, which Vitest 5 no longer reads", async () => {
		writeFileSync(join(fixtureRoot, "vitest.workspace.ts"), "export default [];\n");
		const target = join(fixtureRoot, "packages", "foo", "lib", "a.test.ts");
		const result = await runBin(["agent", "check-test-path", target], { cwd: fixtureRoot });

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
	});
});
