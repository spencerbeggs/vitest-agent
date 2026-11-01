/**
 * End-to-end subprocess tests for `db query`.
 *
 * Spawns the built CLI bin via `node dist/dev/pkg/bin/vitest-agent.js` in a
 * hermetic `CliTest` sandbox so each test gets an isolated data.db path.
 * Tests cover:
 *   - SELECT against a fresh database exits 0 with tabular output
 *   - Schema introspection via sqlite_master exits 0 and lists tables
 *   - A mutation attempt is rejected by the read-only connection (exit 3)
 *   - A SQL syntax error surfaces to stderr (exit 3)
 *   - Empty / whitespace-only SQL exits 2
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "../utils/cli-test.js";
import { expectOk, openSession } from "../utils/cli-test.js";

let session: CliSession;
let workspaceDir: string;

/** Run the bin from the fixture workspace; the sandbox owns XDG_DATA_HOME. */
const runBin = (args: ReadonlyArray<string>) => session.run(args, { cwd: workspaceDir });

beforeEach(async () => {
	session = await openSession();
	workspaceDir = join(session.sandbox.root, "workspace");
	mkdirSync(workspaceDir);
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "db-query-fixture" }), "utf-8");
	// Seed a migrated data.db so the schema (turns, test_runs, ...) exists.
	expectOk(await runBin(["db", "prune"]), ["db", "prune"]);
});

afterEach(() => session.close());

describe("vitest-agent db query", () => {
	it("should exit 0 with tabular output for a SELECT", async () => {
		// When: a trivial SELECT is run
		const result = await runBin(["db", "query", "SELECT 1"]);

		// Then: exit 0, output contains the single result value
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("1");
	});

	it("should exit 0 and list known tables for a sqlite_master introspection query", async () => {
		// When: the schema is introspected
		const result = await runBin(["db", "query", "SELECT name FROM sqlite_master WHERE type='table'"]);

		// Then: exit 0, output lists known tables
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("turns");
	});

	it("should exit 3 with a readonly-database error when a mutation is attempted", async () => {
		// When: an INSERT is run against the read-only connection
		const result = await runBin(["db", "query", "INSERT INTO turns (id) VALUES (1)"]);

		// Then: exit 3, stderr reports the read-only violation
		expect(result.exitCode).toBe(3);
		expect(result.stderr).toContain("readonly database");
	});

	it("should exit 3 with a syntax error for malformed SQL", async () => {
		// When: malformed SQL is run
		const result = await runBin(["db", "query", "not sql"]);

		// Then: exit 3, stderr reports the syntax error
		expect(result.exitCode).toBe(3);
		expect(result.stderr).toContain("syntax error");
	});

	it("should exit 2 with a missing-sql message for whitespace-only SQL", async () => {
		// When: whitespace-only SQL is provided
		const result = await runBin(["db", "query", "   "]);

		// Then: exit 2, stderr reports the missing argument
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("missing sql");
	});
});
