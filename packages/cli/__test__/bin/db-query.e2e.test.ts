/**
 * End-to-end subprocess tests for `db query`.
 *
 * Spawns the built CLI bin via `node dist/dev/bin/vitest-agent.js` with a
 * controlled XDG_DATA_HOME so each test gets an isolated data.db path.
 * Tests cover:
 *   - SELECT against a fresh database exits 0 with tabular output
 *   - Schema introspection via sqlite_master exits 0 and lists tables
 *   - A mutation attempt is rejected by the read-only connection (exit 3)
 *   - A SQL syntax error surfaces to stderr (exit 3)
 *   - Empty / whitespace-only SQL exits 2
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = resolve(__dirname, "..", "..", "dist", "dev", "bin", "vitest-agent.js");

interface SpawnResult {
	stdout: string;
	stderr: string;
	status: number | null;
}

const runBin = (args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): SpawnResult => {
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
let env: NodeJS.ProcessEnv;

beforeEach(() => {
	xdgDataDir = mkdtempSync(join(tmpdir(), "db-query-xdg-"));
	env = { XDG_DATA_HOME: xdgDataDir };
	// Seed a migrated data.db so the schema (turns, test_runs, ...) exists.
	runBin(["db", "prune"], { env });
});

afterEach(() => {
	rmSync(xdgDataDir, { recursive: true, force: true });
});

describe("vitest-agent db query", () => {
	it("should exit 0 with tabular output for a SELECT", () => {
		// When: a trivial SELECT is run
		const result = runBin(["db", "query", "SELECT 1"], { env });

		// Then: exit 0, output contains the single result value
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("1");
	});

	it("should exit 0 and list known tables for a sqlite_master introspection query", () => {
		// When: the schema is introspected
		const result = runBin(["db", "query", "SELECT name FROM sqlite_master WHERE type='table'"], { env });

		// Then: exit 0, output lists known tables
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("turns");
	});

	it("should exit 3 with a readonly-database error when a mutation is attempted", () => {
		// When: an INSERT is run against the read-only connection
		const result = runBin(["db", "query", "INSERT INTO turns (id) VALUES (1)"], { env });

		// Then: exit 3, stderr reports the read-only violation
		expect(result.status).toBe(3);
		expect(result.stderr).toContain("readonly database");
	});

	it("should exit 3 with a syntax error for malformed SQL", () => {
		// When: malformed SQL is run
		const result = runBin(["db", "query", "not sql"], { env });

		// Then: exit 3, stderr reports the syntax error
		expect(result.status).toBe(3);
		expect(result.stderr).toContain("syntax error");
	});

	it("should exit 2 with a missing-sql message for whitespace-only SQL", () => {
		// When: whitespace-only SQL is provided
		const result = runBin(["db", "query", "   "], { env });

		// Then: exit 2, stderr reports the missing argument
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("missing sql");
	});
});
