/**
 * The stderr line and exit code of a failing hook command: one line,
 * nothing on stdout,
 * and the `VITEST_REPORTER_LOG_FILE` sink keeps its tail because the handler
 * succeeds and the run ends normally (issue #675).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "../utils/cli-test.js";
import { openSession } from "../utils/cli-test.js";

let session: CliSession;
let workspaceDir: string;
let pluginDataDir: string;

beforeEach(async () => {
	session = await openSession();
	workspaceDir = join(session.sandbox.root, "workspace");
	pluginDataDir = join(session.sandbox.root, "plugin-data");
	mkdirSync(workspaceDir);
	mkdirSync(pluginDataDir);
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "hook-failure-fixture" }), "utf-8");
});

afterEach(() => session.close());

const run = (args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) =>
	session.run(args, { cwd: workspaceDir, env: { CLAUDE_PLUGIN_DATA: pluginDataDir, ...env } });

describe("the sidecar family's stderr line", () => {
	it("is `<code> <tag>: <message>` for a typed failure, even with an empty message", async () => {
		const result = await run([
			"agent",
			"end-agent",
			"--agent-id=00000000-0000-0000-0000-000000000000",
			`--cwd=${workspaceDir}`,
		]);

		expect(result.exitCode).toBe(5);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("5 AgentNotFoundError: \n");
	});

	it("names the failure and its cause, on one line, when the data directory cannot be created", async () => {
		const result = await run(
			["agent", "end-agent", "--agent-id=x", `--cwd=${workspaceDir}`, "--project-key=pinned-key"],
			{ XDG_DATA_HOME: "/dev/null/blocked", CLAUDE_PLUGIN_DATA: "/dev/null/blocked" },
		);

		expect(result.exitCode).toBe(5);
		expect(result.stdout).toBe("");
		expect(result.stderr).toMatch(
			/^5 AppDirsError: Failed to create the data directory at "\/dev\/null\/blocked\/vitest-agent": [^\n]+\n$/,
		);
	});
});

describe("the record family's stderr line", () => {
	it("is `record <name>: <error>` with exit 1", async () => {
		const result = await run(["agent", "record", "session-end", "--chat-id=unknown"]);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("record session-end: Unknown chatId: unknown\n");
	});

	it("writes the message as given: no format expansion, line break or escape removed", async () => {
		const chatId = "%s %d\nsecond\u001b[31mred\u001b[0m";
		const result = await run(["agent", "record", "session-end", `--chat-id=${chatId}`]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(`record session-end: Unknown chatId: ${chatId}\n`);
	});
});

describe("the log file sink on a failing hook call", () => {
	it("still holds every record written before the failure, and exits with the recorded code", async () => {
		const logFile = join(session.sandbox.root, "hook.ndjson");
		expect(existsSync(logFile)).toBe(false);

		// A fresh data directory: the migrator logs while the layer builds, then the handler fails.
		const result = await run(["agent", "record", "turn", "--chat-id=c1", "{not json"], {
			VITEST_REPORTER_LOG_FILE: logFile,
			VITEST_REPORTER_LOG_LEVEL: "debug",
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		const messages = readFileSync(logFile, "utf-8")
			.trimEnd()
			.split("\n")
			.map((line) => (JSON.parse(line) as { readonly message: unknown }).message);
		expect(messages.at(-1)).toBe("Migrations complete");
		expect(result.stderr.trimEnd().split("\n").at(-1)).toBe("record turn: Invalid JSON: Expected a valid JSON string");
	});
});
