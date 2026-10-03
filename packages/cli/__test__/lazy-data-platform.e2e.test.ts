/**
 * End-to-end tests for the follow-up to issue #561: the CLI opens the project
 * `data.db` only for commands that read or write it.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BinExitError, runBin } from "./utils/run-bin.js";

const PROJECT_KEY = "lazy-key";
const HOST_SESSION_ID = "22222222-2222-4222-8222-222222222222";

let workspaceDir: string;
let otherDir: string;
let xdgDataDir: string;
let pluginDataDir: string;

beforeEach(() => {
	workspaceDir = mkdtempSync(join(tmpdir(), "lazy-ws-"));
	otherDir = mkdtempSync(join(tmpdir(), "lazy-other-"));
	xdgDataDir = mkdtempSync(join(tmpdir(), "lazy-xdg-"));
	pluginDataDir = mkdtempSync(join(tmpdir(), "lazy-plugin-"));
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "lazy-fixture" }), "utf-8");
	writeFileSync(join(otherDir, "package.json"), JSON.stringify({ name: "lazy-other-fixture" }), "utf-8");
	mkdirSync(join(workspaceDir, "src"), { recursive: true });
});

afterEach(() => {
	for (const dir of [workspaceDir, otherDir, xdgDataDir, pluginDataDir]) {
		rmSync(dir, { recursive: true, force: true });
	}
});

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
	const base: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: xdgDataDir, CLAUDE_PLUGIN_DATA: pluginDataDir };
	delete base.VITEST_AGENT_PROJECT_DIR;
	delete base.CLAUDE_PROJECT_DIR;
	delete base.VITEST_AGENT_REPORTER_PROJECT_DIR;
	return { ...base, ...extra };
};

/** Every `<xdg>/vitest-agent/<key>/data.db` that exists, as `<key>` names. */
const dataDbKeys = (): Array<string> => {
	const root = join(xdgDataDir, "vitest-agent");
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "data.db")))
		.map((entry) => entry.name);
};

describe("lazy project data platform", () => {
	it("should create only the --project-key data.db when registering an agent", () => {
		runBin(
			[
				"agent",
				"register-agent",
				"--host-kind=claude-code",
				"--agent-type=main",
				`--host-session-id=${HOST_SESSION_ID}`,
				"--transcript-path=/tmp/lazy.jsonl",
				`--cwd=${workspaceDir}`,
				`--project-key=${PROJECT_KEY}`,
			],
			env(),
		);

		expect(dataDbKeys()).toEqual([PROJECT_KEY]);
	});

	it("should create no data.db for check-test-path and inject-env", () => {
		try {
			runBin(
				["agent", "check-test-path", join(workspaceDir, "src", "a.test.ts")],
				env({ VITEST_AGENT_PROJECT_DIR: workspaceDir }),
			);
		} catch (error) {
			// Exit 1 means "no verdict" (fail open); only the side effects matter here.
			if (!(error instanceof BinExitError)) throw error;
		}
		runBin(["agent", "inject-env", "--command=ls", `--cwd=${workspaceDir}`], env());

		expect(dataDbKeys()).toEqual([]);
	});

	it("should resolve db path from CLAUDE_PROJECT_DIR and create no data.db", () => {
		const { stdout } = runBin(["db", "path"], env({ CLAUDE_PROJECT_DIR: workspaceDir }));

		expect(stdout.trim()).toContain("lazy-fixture");
		expect(dataDbKeys()).toEqual([]);
	});

	it("should still create the cwd-derived data.db when running doctor", () => {
		try {
			runBin(["doctor"], env({ VITEST_AGENT_PROJECT_DIR: workspaceDir }));
		} catch (error) {
			if (!(error instanceof BinExitError)) throw error;
		}

		expect(dataDbKeys()).toEqual(["lazy-fixture"]);
	});
});
