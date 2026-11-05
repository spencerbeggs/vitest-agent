/**
 * `vitest-agent db prune` run retention (issue 623): `--keep-runs` /
 * `--max-age-days` apply `DataStore.pruneRuns` to the project `data.db`,
 * the session-turn prune keeps working, and the manual path checkpoints
 * the WAL. Spawns the built dev bin, so the suite is `.e2e.test.ts`.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DataStore, makeTestLayer } from "@vitest-agent/engine/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "./utils/cli-test.js";
import { openSession } from "./utils/cli-test.js";

let session: CliSession;
let workspaceDir: string;

beforeEach(async () => {
	session = await openSession();
	workspaceDir = join(session.sandbox.root, "workspace");
	mkdirSync(workspaceDir);
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "prune-fixture" }), "utf-8");
});

afterEach(() => session.close());

/** Run the bin against the fixture workspace (the sandbox owns XDG_DATA_HOME). */
const run = (args: ReadonlyArray<string>) => session.run(args, { env: { VITEST_AGENT_PROJECT_DIR: workspaceDir } });
const runOk = (args: ReadonlyArray<string>) =>
	session.run(args, { env: { VITEST_AGENT_PROJECT_DIR: workspaceDir }, expectExit: 0 });

const runInput = (project: string, timestamp: string) => ({
	invocationId: `inv-${project}-${timestamp}`,
	project,
	settingsHash: "h",
	timestamp,
	commitSha: null,
	branch: null,
	reason: "passed" as const,
	duration: 1,
	total: 1,
	passed: 1,
	failed: 0,
	skipped: 0,
	scoped: false,
});

/** Seed `dbPath` (migrating it) with `n` runs of one project, one module each. */
const seedRuns = (dbPath: string, n: number, timestamps: ReadonlyArray<string>) =>
	Effect.runPromise(
		Effect.provide(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSettings("h", { vitestVersion: "5.0.0" }, {});
				for (let i = 0; i < n; i++) {
					const runId = yield* store.writeRun(runInput("alpha", timestamps[i]));
					const fileId = yield* store.ensureFile(`alpha/run-${i}.test.ts`);
					yield* store.writeModules(runId, [{ fileId, relativeModuleId: `alpha/run-${i}.test.ts`, state: "passed" }]);
				}
			}),
			makeTestLayer(dbPath),
		),
	);

const countRuns = (dbPath: string): number => {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		return (db.prepare("SELECT COUNT(*) AS c FROM test_runs").get() as { c: number }).c;
	} finally {
		db.close();
	}
};

const ts = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;

describe("db prune run retention", () => {
	it("keeps only the newest --keep-runs runs and checkpoints the WAL", async () => {
		const dbPath = (await runOk(["db", "path"])).stdout.trim();
		await seedRuns(dbPath, 4, [ts(1), ts(2), ts(3), ts(4)]);
		expect(countRuns(dbPath)).toBe(4);

		const result = await runOk(["db", "prune", "--keep-runs", "2"]);

		expect(result.stdout).toContain("Pruned 0 turn row(s)");
		expect(result.stdout).toContain(
			"Pruned 2 run(s) and 2 orphaned file row(s); kept the newest 2 run(s) per project.",
		);
		expect(countRuns(dbPath)).toBe(2);
		// The manual path truncates the WAL after pruning.
		const wal = `${dbPath}-wal`;
		expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
	});

	it("drops runs older than --max-age-days while keeping the default window", async () => {
		const dbPath = (await runOk(["db", "path"])).stdout.trim();
		const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
		await seedRuns(dbPath, 2, [old, new Date().toISOString()]);

		const result = await runOk(["db", "prune", "--max-age-days", "30"]);

		expect(result.stdout).toContain("kept the newest 200 run(s) per project, none older than 30 day(s).");
		expect(countRuns(dbPath)).toBe(1);
	});

	it("honours [retention] enabled = false unless a flag asks for a prune", async () => {
		writeFileSync(join(workspaceDir, "vitest-agent.config.toml"), "[retention]\nenabled = false\n", "utf-8");
		const dbPath = (await runOk(["db", "path"])).stdout.trim();
		await seedRuns(dbPath, 3, [ts(1), ts(2), ts(3)]);

		const disabled = await runOk(["db", "prune"]);
		expect(disabled.stdout).toContain("Run retention is disabled");
		expect(countRuns(dbPath)).toBe(3);

		const forced = await runOk(["db", "prune", "--keep-runs", "1"]);
		expect(forced.stdout).toContain("Pruned 2 run(s)");
		expect(countRuns(dbPath)).toBe(1);
	});

	it("rejects --keep-runs 0 as a usage error", async () => {
		const result = await run(["db", "prune", "--keep-runs", "0"]);
		expect(result.exitCode).toBe(64);
	});
});
