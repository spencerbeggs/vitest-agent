/**
 * Unit tests for inventory({ kind: "tag" }) MCP tool.
 *
 * Covers the asymmetric output shape:
 *   - scoped (project supplied)   → inventoryKind: "tag_scoped"
 *   - unscoped (no project)       → inventoryKind: "tag_unscoped" with byProject breakdown
 *
 * Plus the markdown formatter for both shapes, the empty-database fallback,
 * and that the structured payload round-trips the InventoryResult schema.
 */
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataStore, OutputPipelineLive, ProjectDiscoveryTest } from "vitest-agent-sdk";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import type { InventoryResultType } from "../src/tools/inventory.js";
import { InventoryResult, formatInventoryMarkdown } from "../src/tools/inventory.js";
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

const seedTwoProjectFixture = async () => {
	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("inv-tag-hash", settingsInput, {});

			// proj-a: two int-tagged tests in one module + one e2e-tagged test in another module
			const runA = yield* store.writeRun({
				invocationId: "inv-tag-a",
				project: "proj-a",
				settingsHash: "inv-tag-hash",
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
			const fileA1 = yield* store.ensureFile("src/a-int.test.ts");
			const fileA2 = yield* store.ensureFile("src/a-e2e.test.ts");
			const [modA1, modA2] = yield* store.writeModules(runA, [
				{ fileId: fileA1, relativeModuleId: "src/a-int.test.ts", state: "passed", duration: 50 },
				{ fileId: fileA2, relativeModuleId: "src/a-e2e.test.ts", state: "passed", duration: 50 },
			]);
			yield* store.writeTestCases(modA1, [
				{ name: "int 1", fullName: "a > int 1", state: "passed", tags: ["int"] },
				{ name: "int 2", fullName: "a > int 2", state: "passed", tags: ["int"] },
			]);
			yield* store.writeTestCases(modA2, [{ name: "e2e 1", fullName: "a > e2e 1", state: "passed", tags: ["e2e"] }]);

			// proj-b: one int-tagged test
			const runB = yield* store.writeRun({
				invocationId: "inv-tag-b",
				project: "proj-b",
				settingsHash: "inv-tag-hash",
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
			const fileB = yield* store.ensureFile("src/b-int.test.ts");
			const [modB] = yield* store.writeModules(runB, [
				{ fileId: fileB, relativeModuleId: "src/b-int.test.ts", state: "passed", duration: 30 },
			]);
			yield* store.writeTestCases(modB, [{ name: "int b", fullName: "b > int b", state: "passed", tags: ["int"] }]);
		}),
	);
};

// Seed once at file scope. Re-seeding within tests with the same timestamps
// would cause the latest-run-per-project filter to find duplicates; seeding
// once via beforeAll keeps each test independent of ordering without the
// timestamp dance.
beforeAll(async () => {
	await seedTwoProjectFixture();
});

describe("inventory({ kind: 'tag' }) — scoped", () => {
	it("returns inventoryKind 'tag_scoped' with the project name and per-tag rows", async () => {
		const caller = makeCaller();
		const result = (await caller.inventory({ kind: "tag", project: "proj-a" })) as InventoryResultType;
		expect(result.inventoryKind).toBe("tag_scoped");
		if (result.inventoryKind !== "tag_scoped") return;
		expect(result.project).toBe("proj-a");
		expect(result.count).toBe(2); // int, e2e
		const intRow = result.tags.find((t) => t.tag === "int");
		expect(intRow?.moduleCount).toBe(1);
		expect(intRow?.testCount).toBe(2);
		const e2eRow = result.tags.find((t) => t.tag === "e2e");
		expect(e2eRow?.moduleCount).toBe(1);
		expect(e2eRow?.testCount).toBe(1);
	});

	it("returns an empty tag list for a project with no tagged tests", async () => {
		// Use a project name that does not appear in the seeded fixture.
		const caller = makeCaller();
		const result = (await caller.inventory({ kind: "tag", project: "proj-nonexistent" })) as InventoryResultType;
		expect(result.inventoryKind).toBe("tag_scoped");
		if (result.inventoryKind !== "tag_scoped") return;
		expect(result.project).toBe("proj-nonexistent");
		expect(result.count).toBe(0);
		expect(result.tags).toEqual([]);
	});
});

describe("inventory({ kind: 'tag' }) — unscoped", () => {
	it("returns inventoryKind 'tag_unscoped' and carries a byProject breakdown per tag", async () => {
		const caller = makeCaller();
		const result = (await caller.inventory({ kind: "tag" })) as InventoryResultType;
		expect(result.inventoryKind).toBe("tag_unscoped");
		if (result.inventoryKind !== "tag_unscoped") return;
		expect(result.count).toBeGreaterThanOrEqual(2);

		const intRow = result.tags.find((t) => t.tag === "int");
		expect(intRow).toBeDefined();
		// int appears in proj-a (2 tests) and proj-b (1 test).
		expect(intRow?.testCount).toBe(3);
		expect(intRow?.moduleCount).toBe(2);
		expect(intRow?.byProject.find((b) => b.project === "proj-a")?.testCount).toBe(2);
		expect(intRow?.byProject.find((b) => b.project === "proj-b")?.testCount).toBe(1);

		const e2eRow = result.tags.find((t) => t.tag === "e2e");
		expect(e2eRow).toBeDefined();
		expect(e2eRow?.byProject.length).toBe(1);
		expect(e2eRow?.byProject[0].project).toBe("proj-a");
	});
});

describe("formatInventoryMarkdown — tag variants", () => {
	it("renders the scoped table with Modules / Tests columns", () => {
		const md = formatInventoryMarkdown({
			inventoryKind: "tag_scoped",
			project: "proj-x",
			count: 2,
			tags: [
				{ tag: "int", moduleCount: 2, testCount: 5 },
				{ tag: "e2e", moduleCount: 1, testCount: 2 },
			],
		});
		expect(md).toContain("## Tags — proj-x");
		expect(md).toContain("| Tag | Modules | Tests |");
		expect(md).toContain("| int | 2 | 5 |");
		expect(md).toContain("| e2e | 1 | 2 |");
	});

	it("renders the unscoped table including the Projects breakdown", () => {
		const md = formatInventoryMarkdown({
			inventoryKind: "tag_unscoped",
			count: 1,
			tags: [
				{
					tag: "int",
					moduleCount: 2,
					testCount: 3,
					byProject: [
						{ project: "proj-a", moduleCount: 1, testCount: 2 },
						{ project: "proj-b", moduleCount: 1, testCount: 1 },
					],
				},
			],
		});
		expect(md).toContain("## Tags");
		expect(md).toContain("| Tag | Modules | Tests | Projects |");
		expect(md).toContain("proj-a (2)");
		expect(md).toContain("proj-b (1)");
	});

	it("falls back to the empty message when count is zero", () => {
		const mdScoped = formatInventoryMarkdown({
			inventoryKind: "tag_scoped",
			project: "proj-empty",
			count: 0,
			tags: [],
		});
		expect(mdScoped).toContain("No tags recorded for project `proj-empty`");

		const mdUnscoped = formatInventoryMarkdown({
			inventoryKind: "tag_unscoped",
			count: 0,
			tags: [],
		});
		expect(mdUnscoped).toContain("No tags recorded");
	});
});

describe("InventoryResult schema accepts the new tag variants", () => {
	it("round-trips tag_scoped through encode + decode", () => {
		const payload: InventoryResultType = {
			inventoryKind: "tag_scoped",
			project: "proj-x",
			count: 1,
			tags: [{ tag: "int", moduleCount: 1, testCount: 2 }],
		};
		const encoded = Schema.encodeUnknownSync(InventoryResult)(payload);
		const decoded = Schema.decodeUnknownSync(InventoryResult)(encoded);
		expect(decoded.inventoryKind).toBe("tag_scoped");
	});

	it("round-trips tag_unscoped through encode + decode", () => {
		const payload: InventoryResultType = {
			inventoryKind: "tag_unscoped",
			count: 1,
			tags: [
				{
					tag: "int",
					moduleCount: 2,
					testCount: 3,
					byProject: [{ project: "proj-a", moduleCount: 1, testCount: 2 }],
				},
			],
		};
		const encoded = Schema.encodeUnknownSync(InventoryResult)(payload);
		const decoded = Schema.decodeUnknownSync(InventoryResult)(encoded);
		expect(decoded.inventoryKind).toBe("tag_unscoped");
	});
});
