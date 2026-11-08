/**
 * End-to-end subprocess tests for `db reset`.
 *
 * Spawns the built CLI bin via `node dist/prod/npm/pkg/bin/vitest-agent.js` in a
 * hermetic `CliTest` sandbox so each test gets an isolated data.db path.
 * Tests cover:
 *   - Agent-context blocking (VITEST_AGENT_AGENT_ID present) exits 4
 *   - Non-interactive (no TTY, or a non-human audience) without --yes exits 5
 *   - Successful deletion with --yes (non-TTY) exits 0, db gone
 *   - Idempotent success when db does not exist exits 0
 *
 * The interactive TTY path (gate 3) cannot be exercised without a pseudo-tty
 * and is not tested here. Gate 2 is `@effected/cli-kit`'s `CliInteractive`: a
 * human audience with a terminal on stdin and stdout. An audience flag
 * recomputes it, so `--human` under `CLAUDECODE=1` on a pty reaches the
 * prompt (verified by hand; there is no pty driver in this suite).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "../utils/cli-test.js";
import { openSession } from "../utils/cli-test.js";

let session: CliSession;
let workspaceDir: string;

/**
 * Run the bin from the fixture workspace. The sandbox owns XDG_DATA_HOME and
 * inherits nothing from the host, so no `VITEST_AGENT_AGENT_ID` (gate 1) or
 * agent audience variable leaks in unless a test passes it.
 */
const runBin = (args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) =>
	session.run(args, { cwd: workspaceDir, env });

beforeEach(async () => {
	session = await openSession();
	workspaceDir = join(session.sandbox.root, "workspace");
	mkdirSync(workspaceDir);
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "db-reset-fixture" }), "utf-8");
});

afterEach(() => session.close());

/** Run `db path` to get the resolved data.db path. */
const resolveDbPath = async (): Promise<string> =>
	(await session.run(["db", "path"], { cwd: workspaceDir, expectExit: 0 })).stdout.trim();

describe("vitest-agent db reset", () => {
	// Gate 1: agent env check — VITEST_AGENT_AGENT_ID present → exit 4
	it("should exit 4 with human-only message when VITEST_AGENT_AGENT_ID is set", async () => {
		// Given: agent env var is present
		// When: db reset is invoked
		const result = await runBin(["db", "reset"], { VITEST_AGENT_AGENT_ID: "agent-abc-123" });

		// Then: exit 4, stderr contains the human-only message
		expect(result.exitCode).toBe(4);
		expect(result.stderr).toContain("db reset is human-only");
	});

	it("should exit 5 with requires --yes message when stdout is not a TTY and --yes is absent", async () => {
		// Given: no agent env var (the sandbox inherits none), stdout is not a TTY (piped)
		// When: db reset is invoked without --yes
		const result = await runBin(["db", "reset"]);

		// Then: exit 5, stderr contains requires --yes message
		expect(result.exitCode).toBe(5);
		expect(result.stderr).toContain("requires --yes when the run is not interactive");
		expect(result.stdout).toBe("");
	});

	it("should exit 0, print Deleted database at <path>, and remove the db file when --yes is passed", async () => {
		// Given: no agent env var, db path resolved (migrator creates the db on first run)
		const dbPath = await resolveDbPath();

		// When: db reset --yes is invoked (migrator will create db if absent, then reset deletes it)
		const result = await runBin(["db", "reset", "--yes"]);

		// Then: exit 0, stdout contains success message, db file is gone
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(`Deleted database at ${dbPath}`);
		expect(existsSync(dbPath)).toBe(false);
	});

	it("should exit 0 (idempotent) when --yes is passed but no db file exists", async () => {
		// Given: no agent env var, no db file present
		// When: db reset --yes is invoked with no file present
		const result = await runBin(["db", "reset", "--yes"]);

		// Then: exit 0 (success, idempotent)
		expect(result.exitCode).toBe(0);
	});
});
