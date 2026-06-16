/**
 * End-to-end subprocess tests for `db reset`.
 *
 * Spawns the built CLI bin via `node dist/dev/pkg/bin/vitest-agent.js` with a
 * controlled XDG_DATA_HOME so each test gets an isolated data.db path.
 * Tests cover:
 *   - Agent-context blocking (VITEST_AGENT_AGENT_ID present) exits 4
 *   - Non-TTY without --yes exits 5
 *   - Successful deletion with --yes (non-TTY) exits 0, db gone
 *   - Idempotent success when db does not exist exits 0
 *
 * The interactive TTY path (gate 3) cannot be exercised without a pseudo-tty
 * and is not tested here.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = resolve(__dirname, "..", "..", "dist", "dev", "pkg", "bin", "vitest-agent.js");

interface SpawnResult {
	stdout: string;
	stderr: string;
	status: number | null;
}

const runBin = (args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): SpawnResult => {
	// Merge parent env with overrides; keys set to undefined are explicitly removed.
	const merged: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
	for (const key of Object.keys(merged)) {
		if (merged[key] === undefined) {
			delete merged[key];
		}
	}
	const result = spawnSync("node", [BIN, ...args], {
		env: merged,
		cwd: opts.cwd ?? process.cwd(),
		encoding: "utf-8",
	});
	return {
		stdout: typeof result.stdout === "string" ? result.stdout : "",
		stderr: typeof result.stderr === "string" ? result.stderr : "",
		status: result.status,
	};
};

let xdgDataDir: string;

beforeEach(() => {
	xdgDataDir = mkdtempSync(join(tmpdir(), "db-reset-xdg-"));
});

afterEach(() => {
	rmSync(xdgDataDir, { recursive: true, force: true });
});

const resolveDbPath = (xdgDir: string): string => {
	// Run `db path` with the controlled XDG_DATA_HOME to get the resolved path.
	const result = runBin(["db", "path"], { env: { XDG_DATA_HOME: xdgDir } });
	return result.stdout.trim();
};

describe("vitest-agent db reset", () => {
	// Gate 1: agent env check — VITEST_AGENT_AGENT_ID present → exit 4
	it("should exit 4 with human-only message when VITEST_AGENT_AGENT_ID is set", () => {
		// Given: agent env var is present
		const env: NodeJS.ProcessEnv = {
			XDG_DATA_HOME: xdgDataDir,
			VITEST_AGENT_AGENT_ID: "agent-abc-123",
		};

		// When: db reset is invoked
		const result = runBin(["db", "reset"], { env });

		// Then: exit 4, stderr contains the human-only message
		expect(result.status).toBe(4);
		expect(result.stderr).toContain("db reset is human-only");
	});

	it("should exit 5 with requires --yes message when stdout is not a TTY and --yes is absent", () => {
		// Given: no agent env var, stdout is not a TTY (spawnSync has no tty by default)
		const env: NodeJS.ProcessEnv = {
			XDG_DATA_HOME: xdgDataDir,
			VITEST_AGENT_AGENT_ID: undefined,
		};

		// When: db reset is invoked without --yes
		const result = runBin(["db", "reset"], { env });

		// Then: exit 5, stderr contains requires --yes message
		expect(result.status).toBe(5);
		expect(result.stderr).toContain("requires --yes when stdout is not a TTY");
	});

	it("should exit 0, print Deleted database at <path>, and remove the db file when --yes is passed", () => {
		// Given: no agent env var, db path resolved (migrator creates the db on first run)
		const dbPath = resolveDbPath(xdgDataDir);

		const env: NodeJS.ProcessEnv = {
			XDG_DATA_HOME: xdgDataDir,
			VITEST_AGENT_AGENT_ID: undefined,
		};

		// When: db reset --yes is invoked (migrator will create db if absent, then reset deletes it)
		const result = runBin(["db", "reset", "--yes"], { env });

		// Then: exit 0, stdout contains success message, db file is gone
		expect(result.status).toBe(0);
		expect(result.stdout).toContain(`Deleted database at ${dbPath}`);
		expect(existsSync(dbPath)).toBe(false);
	});

	it("should exit 0 (idempotent) when --yes is passed but no db file exists", () => {
		// Given: no agent env var, no db file present
		const env: NodeJS.ProcessEnv = {
			XDG_DATA_HOME: xdgDataDir,
			VITEST_AGENT_AGENT_ID: undefined,
		};

		// When: db reset --yes is invoked with no file present
		const result = runBin(["db", "reset", "--yes"], { env });

		// Then: exit 0 (success, idempotent)
		expect(result.status).toBe(0);
	});
});
