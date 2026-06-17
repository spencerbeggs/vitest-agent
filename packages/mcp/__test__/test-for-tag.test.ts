/**
 * Unit tests for test({ action: "for_tag" }) MCP tool.
 *
 * Mirrors the existing test({ action: "list" }) shape: groups by project
 * when project is omitted; returns a single group when project is supplied.
 */

import { DataStore, OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import type { TestResultType } from "../src/tools/test.js";
import { TestResult, formatTestMarkdown } from "../src/tools/test.js";
import { DataStoreTestLayer } from "./utils/layers.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));
const testRuntime = ManagedRuntime.make(TestLayer);

const makeCaller = () => {
	const factory = createCallerFactory(appRouter);
	return factory({
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	});
};

afterAll(async () => {
	await testRuntime.dispose();
});

const settingsInput = {
	vitestVersion: "3.2.0",
	pool: "forks",
	environment: "node",
	testTimeout: 5000,
	hookTimeout: 10000,
	slowTestThreshold: 300,
	maxConcurrency: 5,
	maxWorkers: 4,
	isolate: true,
	bail: 0,
	globals: false,
	fileParallelism: true,
	sequenceSeed: 42,
	coverageProvider: "v8",
};

const seedFixture = async () => {
	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("for-tag-hash", settingsInput, {});

			// proj-alpha: two int-tagged tests + one plain test
			const runAlpha = yield* store.writeRun({
				invocationId: "for-tag-alpha",
				project: "proj-alpha",
				settingsHash: "for-tag-hash",
				timestamp: "2026-05-01T00:00:00.000Z",
				commitSha: "abc",
				branch: "main",
				reason: "passed" as const,
				duration: 100,
				total: 3,
				passed: 3,
				failed: 0,
				skipped: 0,
				scoped: false,
			});
			const fileAlpha = yield* store.ensureFile("src/alpha.test.ts");
			const [modAlpha] = yield* store.writeModules(runAlpha, [
				{ fileId: fileAlpha, relativeModuleId: "src/alpha.test.ts", state: "passed", duration: 60 },
			]);
			yield* store.writeTestCases(modAlpha, [
				{ name: "int a1", fullName: "alpha > int a1", state: "passed", tags: ["int"] },
				{ name: "int a2", fullName: "alpha > int a2", state: "passed", tags: ["int"] },
				{ name: "plain", fullName: "alpha > plain", state: "passed" },
			]);

			// proj-beta: one int-tagged test
			const runBeta = yield* store.writeRun({
				invocationId: "for-tag-beta",
				project: "proj-beta",
				settingsHash: "for-tag-hash",
				timestamp: "2026-05-01T00:00:00.000Z",
				commitSha: "abc",
				branch: "main",
				reason: "passed" as const,
				duration: 80,
				total: 1,
				passed: 1,
				failed: 0,
				skipped: 0,
				scoped: false,
			});
			const fileBeta = yield* store.ensureFile("src/beta.test.ts");
			const [modBeta] = yield* store.writeModules(runBeta, [
				{ fileId: fileBeta, relativeModuleId: "src/beta.test.ts", state: "passed", duration: 30 },
			]);
			yield* store.writeTestCases(modBeta, [
				{ name: "int b1", fullName: "beta > int b1", state: "passed", tags: ["int"] },
			]);
		}),
	);
};

// Seed once at file scope. The latest-run-per-project filter would
// double-count if we re-seeded with the same timestamps in each test; seeding
// via beforeAll keeps every `it` independent of ordering.
beforeAll(async () => {
	await seedFixture();
});

describe("test({ action: 'for_tag' }) — unscoped", () => {
	it("groups all int-tagged tests by project across the latest run of each project", async () => {
		const caller = makeCaller();
		const result = (await caller.test({ action: "for_tag", tag: "int" })) as TestResultType;
		expect(result.action).toBe("for_tag");
		if (result.action !== "for_tag") return;
		expect(result.tag).toBe("int");
		expect(result.count).toBe(3); // 2 from alpha + 1 from beta
		expect(result.groups.length).toBe(2);
		const alpha = result.groups.find((g) => g.project === "proj-alpha");
		expect(alpha?.tests.length).toBe(2);
		const beta = result.groups.find((g) => g.project === "proj-beta");
		expect(beta?.tests.length).toBe(1);
		expect(beta?.tests[0].fullName).toBe("beta > int b1");
	});
});

describe("test({ action: 'for_tag' }) — project scoped", () => {
	it("returns a single group when project is supplied", async () => {
		const caller = makeCaller();
		const result = (await caller.test({ action: "for_tag", tag: "int", project: "proj-alpha" })) as TestResultType;
		expect(result.action).toBe("for_tag");
		if (result.action !== "for_tag") return;
		expect(result.count).toBe(2);
		expect(result.groups.length).toBe(1);
		expect(result.groups[0].project).toBe("proj-alpha");
		expect(result.groups[0].tests.map((t) => t.fullName).sort()).toEqual(["alpha > int a1", "alpha > int a2"]);
	});

	it("returns empty groups when the tag does not match any test in the project", async () => {
		const caller = makeCaller();
		const result = (await caller.test({
			action: "for_tag",
			tag: "nonexistent",
			project: "proj-alpha",
		})) as TestResultType;
		expect(result.action).toBe("for_tag");
		if (result.action !== "for_tag") return;
		expect(result.count).toBe(0);
		expect(result.groups).toEqual([]);
	});
});

describe("formatTestMarkdown — for_tag", () => {
	it("renders a per-project table when groups are non-empty", () => {
		const md = formatTestMarkdown({
			action: "for_tag",
			tag: "int",
			count: 3,
			groups: [
				{
					project: "proj-alpha",
					tests: [
						{
							id: 1,
							fullName: "alpha > int a1",
							state: "passed",
							duration: 5,
							module: "src/alpha.test.ts",
							classification: null,
						},
					],
				},
				{
					project: "proj-beta",
					tests: [
						{
							id: 2,
							fullName: "beta > int b1",
							state: "passed",
							duration: 3,
							module: "src/beta.test.ts",
							classification: null,
						},
					],
				},
			],
		});
		expect(md).toContain("# Tests tagged `int`");
		expect(md).toContain("Found 3 tests across 2 projects");
		expect(md).toContain("### proj-alpha");
		expect(md).toContain("### proj-beta");
		expect(md).toContain("alpha > int a1");
	});

	it("falls back to the empty message when no tests match", () => {
		const md = formatTestMarkdown({
			action: "for_tag",
			tag: "missing",
			count: 0,
			groups: [],
		});
		expect(md).toContain("No tests found tagged `missing`");
		expect(md).toContain('inventory({ kind: "tag" })');
	});
});

describe("TestResult schema accepts for_tag variant", () => {
	it("round-trips a for_tag payload through encode + decode", () => {
		const payload: TestResultType = {
			action: "for_tag",
			tag: "int",
			count: 1,
			groups: [
				{
					project: "proj-alpha",
					tests: [
						{
							id: 1,
							fullName: "alpha > int a1",
							state: "passed",
							duration: 5,
							module: "src/alpha.test.ts",
							classification: null,
						},
					],
				},
			],
		};
		const encoded = Schema.encodeUnknownSync(TestResult)(payload);
		const decoded = Schema.decodeUnknownSync(TestResult)(encoded);
		expect(decoded.action).toBe("for_tag");
	});
});
