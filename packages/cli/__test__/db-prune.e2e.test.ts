/**
 * `vitest-agent db prune` run retention (issue 623): `--keep-runs` /
 * `--max-age-days` apply `DataStore.pruneRuns` to the project `data.db`,
 * the session-turn prune keeps working, and the manual path checkpoints
 * the WAL. Spawns the built dev bin, so the suite is `.e2e.test.ts`.
 */

import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DataStore, makeTestLayer } from "@vitest-agent/engine/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBin } from "./utils/run-bin.js";

let workspaceDir: string;
let xdgDataDir: string;

beforeEach(() => {
	workspaceDir = mkdtempSync(join(tmpdir(), "prune-ws-"));
	xdgDataDir = mkdtempSync(join(tmpdir(), "prune-xdg-"));
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "prune-fixture" }), "utf-8");
});

afterEach(() => {
	for (const dir of [workspaceDir, xdgDataDir]) rmSync(dir, { recursive: true, force: true });
});

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
	const base: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: xdgDataDir, VITEST_AGENT_PROJECT_DIR: workspaceDir };
	delete base.CLAUDE_PROJECT_DIR;
	delete base.VITEST_AGENT_REPORTER_PROJECT_DIR;
	return { ...base, ...extra };
};

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
		const dbPath = runBin(["db", "path"], env()).stdout.trim();
		await seedRuns(dbPath, 4, [ts(1), ts(2), ts(3), ts(4)]);
		expect(countRuns(dbPath)).toBe(4);

		const result = runBin(["db", "prune", "--keep-runs", "2"], env());

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
		const dbPath = runBin(["db", "path"], env()).stdout.trim();
		const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
		await seedRuns(dbPath, 2, [old, new Date().toISOString()]);

		const result = runBin(["db", "prune", "--max-age-days", "30"], env());

		expect(result.stdout).toContain("kept the newest 200 run(s) per project, none older than 30 day(s).");
		expect(countRuns(dbPath)).toBe(1);
	});

	it("honours [retention] enabled = false unless a flag asks for a prune", async () => {
		writeFileSync(join(workspaceDir, "vitest-agent.config.toml"), "[retention]\nenabled = false\n", "utf-8");
		const dbPath = runBin(["db", "path"], env()).stdout.trim();
		await seedRuns(dbPath, 3, [ts(1), ts(2), ts(3)]);

		const disabled = runBin(["db", "prune"], env());
		expect(disabled.stdout).toContain("Run retention is disabled");
		expect(countRuns(dbPath)).toBe(3);

		const forced = runBin(["db", "prune", "--keep-runs", "1"], env());
		expect(forced.stdout).toContain("Pruned 2 run(s)");
		expect(countRuns(dbPath)).toBe(1);
	});

	it("rejects --keep-runs 0 as a usage error", () => {
		expect(() => runBin(["db", "prune", "--keep-runs", "0"], env())).toThrow(/exited 64/);
	});
});
