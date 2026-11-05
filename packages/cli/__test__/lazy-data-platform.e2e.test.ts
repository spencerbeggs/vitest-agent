/**
 * End-to-end tests for the follow-up to issue #561: the CLI opens the project
 * `data.db` only for commands that read or write it.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "./utils/cli-test.js";
import { openSession } from "./utils/cli-test.js";

const PROJECT_KEY = "lazy-key";
const HOST_SESSION_ID = "22222222-2222-4222-8222-222222222222";

let session: CliSession;
let workspaceDir: string;
let otherDir: string;
let xdgDataDir: string;
let pluginDataDir: string;

beforeEach(async () => {
	session = await openSession();
	const { root } = session.sandbox;
	workspaceDir = join(root, "workspace");
	// The child's cwd: a resolvable identity of its own, so a data.db derived
	// from the cwd (instead of from the flag or env that should win) shows up
	// as an extra `lazy-other-fixture` key.
	otherDir = join(root, "other");
	pluginDataDir = join(root, "plugin-data");
	xdgDataDir = session.sandbox.env.XDG_DATA_HOME ?? "";
	mkdirSync(join(workspaceDir, "src"), { recursive: true });
	mkdirSync(otherDir);
	mkdirSync(pluginDataDir);
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "lazy-fixture" }), "utf-8");
	writeFileSync(join(otherDir, "package.json"), JSON.stringify({ name: "lazy-other-fixture" }), "utf-8");
});

/** Run the bin from `otherDir`; the sandbox owns XDG_DATA_HOME and nothing is inherited. */
const run = (args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) =>
	session.run(args, { cwd: otherDir, env: { CLAUDE_PLUGIN_DATA: pluginDataDir, ...env } });
const runOk = (args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) =>
	session.run(args, { cwd: otherDir, env: { CLAUDE_PLUGIN_DATA: pluginDataDir, ...env }, expectExit: 0 });

afterEach(() => session.close());

/** Every `<xdg>/vitest-agent/<key>/data.db` that exists, as `<key>` names. */
const dataDbKeys = (): Array<string> => {
	const root = join(xdgDataDir, "vitest-agent");
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "data.db")))
		.map((entry) => entry.name);
};

describe("lazy project data platform", () => {
	it("should create only the --project-key data.db when registering an agent", async () => {
		await runOk([
			"agent",
			"register-agent",
			"--host-kind=claude-code",
			"--agent-type=main",
			`--host-session-id=${HOST_SESSION_ID}`,
			"--transcript-path=/tmp/lazy.jsonl",
			`--cwd=${workspaceDir}`,
			`--project-key=${PROJECT_KEY}`,
		]);

		expect(dataDbKeys()).toEqual([PROJECT_KEY]);
	});

	it("should create no data.db for check-test-path and inject-env", async () => {
		// Any exit is accepted (1 means "no verdict", fail open); only the side effects matter here.
		await run(["agent", "check-test-path", join(workspaceDir, "src", "a.test.ts")], {
			VITEST_AGENT_PROJECT_DIR: workspaceDir,
		});
		await runOk(["agent", "inject-env", "--command=ls", `--cwd=${workspaceDir}`]);

		expect(dataDbKeys()).toEqual([]);
	});

	it("should resolve db path from CLAUDE_PROJECT_DIR and create no data.db", async () => {
		const { stdout } = await runOk(["db", "path"], { CLAUDE_PROJECT_DIR: workspaceDir });

		expect(stdout.trim()).toContain("lazy-fixture");
		expect(dataDbKeys()).toEqual([]);
	});

	it("should still create the cwd-derived data.db when running doctor", async () => {
		// Any exit is accepted: doctor may report findings; only the side effect matters here.
		await run(["doctor"], { VITEST_AGENT_PROJECT_DIR: workspaceDir });

		expect(dataDbKeys()).toEqual(["lazy-fixture"]);
	});
});
