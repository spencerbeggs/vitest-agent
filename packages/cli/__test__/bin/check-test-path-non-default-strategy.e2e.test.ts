/**
 * End-to-end subprocess test for `agent check-test-path` failing open when
 * the workspace's Vitest config indicates a non-default `DiscoverStrategy`
 * (issue #230). Loading the consumer's config to determine the strategy
 * actually in force is out of scope for a hook hot path — instead the CLI
 * scans the config file's source text for lexical markers and fails open
 * (exit 1, no stdout) when one is present, or when the config cannot be read.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = resolve(__dirname, "..", "..", "dist", "dev", "pkg", "bin", "vitest-agent.js");

interface SpawnResult {
	stdout: string;
	stderr: string;
	status: number | null;
}

const runBin = (args: string[], opts: { cwd: string }): SpawnResult => {
	const result = spawnSync("node", [BIN, ...args], {
		cwd: opts.cwd,
		env: { ...process.env, VITEST_AGENT_PROJECT_DIR: opts.cwd },
		encoding: "utf-8",
	});
	return {
		stdout: typeof result.stdout === "string" ? result.stdout : "",
		stderr: typeof result.stderr === "string" ? result.stderr : "",
		status: result.status,
	};
};

let fixtureRoot: string;

beforeEach(() => {
	fixtureRoot = mkdtempSync(join(tmpdir(), "check-test-path-fixture-"));
	writeFileSync(join(fixtureRoot, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
	writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ name: "fixture-root", private: true }));
	mkdirSync(join(fixtureRoot, "packages", "foo", "src"), { recursive: true });
	writeFileSync(
		join(fixtureRoot, "packages", "foo", "package.json"),
		JSON.stringify({ name: "foo", version: "0.0.0" }),
	);
});

afterEach(() => {
	rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("agent check-test-path — non-default discover strategy fail-open", () => {
	it("exits 1 with empty stdout when the vitest config carries a discoverStrategy marker", () => {
		writeFileSync(
			join(fixtureRoot, "vitest.config.ts"),
			`import { AgentPlugin } from "@vitest-agent/plugin";\nexport default { plugins: [AgentPlugin({ discoverStrategy: false })] };\n`,
		);
		const target = join(fixtureRoot, "packages", "foo", "lib", "a.test.ts");
		const result = runBin(["agent", "check-test-path", target], { cwd: fixtureRoot });

		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
	});

	it("still renders a verdict when the vitest config has no strategy markers", () => {
		writeFileSync(
			join(fixtureRoot, "vitest.config.ts"),
			`import { AgentPlugin } from "@vitest-agent/plugin";\nexport default { plugins: [AgentPlugin({ console })] };\n`,
		);
		const target = join(fixtureRoot, "packages", "foo", "lib", "a.test.ts");
		const result = runBin(["agent", "check-test-path", target], { cwd: fixtureRoot });

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "invalid" });
	});
});
