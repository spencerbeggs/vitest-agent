/**
 * Integration tests for the T2 tag-filtering MCP surface.
 *
 * Seeds a multi-tag fixture into the persistence layer, then walks the
 * three new tool surfaces end-to-end via the tRPC caller:
 *   inventory({ kind: "tag" })        — scoped + unscoped pivots
 *   test({ action: "for_tag" })       — per-project grouping
 *
 * The run_tests tag filter and no-match discriminator are exercised by
 * unit tests under packages/mcp/__test__/run-tests.test.ts (the schema
 * round trip and composer cover the wire-level contract; the actual
 * Vitest spawn is verified by manual smoke run).
 */
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { DataStore } from "vitest-agent-sdk";
import type { McpContext } from "../../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../../src/context.js";
import { appRouter } from "../../src/router.js";
import type { InventoryResultType } from "../../src/tools/inventory.js";
import type { TestResultType } from "../../src/tools/test.js";
import { test as base } from "./utils/fixtures.js";

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

/**
 * Seed three test files with overlapping tag combinations into two
 * projects. Designed to make AND/OR/NOT semantics visible:
 *
 *   proj-x:
 *     fixture-a.test.ts (unit only)
 *     fixture-b.test.ts (int + slow)
 *     fixture-c.test.ts (e2e + int)
 *   proj-y:
 *     fixture-d.test.ts (int)        — same tag as proj-x but different project
 *
 * Seeded once per file via the `seeded` fixture below; the listTagInventory
 * reader filters to the latest run per project, so re-seeding within the
 * file would multiply the latest-run rows and double-count tags.
 */
const test = base.extend<{ seeded: true }>({
	seeded: [
		async ({ runtime }, use) => {
			await runtime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					yield* store.writeSettings("int-tag-fixture", settingsInput, {});

					const runX = yield* store.writeRun({
						invocationId: "int-tag-x",
						project: "proj-x",
						settingsHash: "int-tag-fixture",
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
					const fa = yield* store.ensureFile("fixture-a.test.ts");
					const fb = yield* store.ensureFile("fixture-b.test.ts");
					const fc = yield* store.ensureFile("fixture-c.test.ts");
					const [modA, modB, modC] = yield* store.writeModules(runX, [
						{ fileId: fa, relativeModuleId: "fixture-a.test.ts", state: "passed", duration: 10 },
						{ fileId: fb, relativeModuleId: "fixture-b.test.ts", state: "passed", duration: 10 },
						{ fileId: fc, relativeModuleId: "fixture-c.test.ts", state: "passed", duration: 10 },
					]);
					yield* store.writeTestCases(modA, [
						{ name: "unit a", fullName: "fixture-a > unit a", state: "passed", tags: ["unit"] },
					]);
					yield* store.writeTestCases(modB, [
						{ name: "int slow b", fullName: "fixture-b > int slow b", state: "passed", tags: ["int", "slow"] },
					]);
					yield* store.writeTestCases(modC, [
						{ name: "e2e int c", fullName: "fixture-c > e2e int c", state: "passed", tags: ["e2e", "int"] },
					]);

					const runY = yield* store.writeRun({
						invocationId: "int-tag-y",
						project: "proj-y",
						settingsHash: "int-tag-fixture",
						timestamp: "2026-05-01T00:00:00.000Z",
						commitSha: "abc",
						branch: "main",
						reason: "passed" as const,
						duration: 50,
						total: 1,
						passed: 1,
						failed: 0,
						skipped: 0,
						scoped: false,
					});
					const fd = yield* store.ensureFile("fixture-d.test.ts");
					const [modD] = yield* store.writeModules(runY, [
						{ fileId: fd, relativeModuleId: "fixture-d.test.ts", state: "passed", duration: 5 },
					]);
					yield* store.writeTestCases(modD, [
						{ name: "int d", fullName: "fixture-d > int d", state: "passed", tags: ["int"] },
					]);
				}),
			);
			await use(true);
		},
		{ scope: "file" },
	],
});

const makeCaller = (runtime: unknown) =>
	createCallerFactory(appRouter)({
		runtime: runtime as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(null),
		sessionContext: createSessionContextRef(),
	});

describe("T2 tag-filtering MCP surface — integration", () => {
	test("inventory({ kind: 'tag' }) unscoped pivots flat reader rows into a per-tag breakdown", async ({
		runtime,
		seeded: _seeded,
	}) => {
		const caller = makeCaller(runtime);
		const result = (await caller.inventory({ kind: "tag" })) as InventoryResultType;
		expect(result.inventoryKind).toBe("tag_unscoped");
		if (result.inventoryKind !== "tag_unscoped") return;

		// Four distinct tags across the fixture: int, slow, e2e, unit
		const tags = result.tags.map((t) => t.tag).sort();
		expect(tags).toEqual(["e2e", "int", "slow", "unit"]);

		const intRow = result.tags.find((t) => t.tag === "int");
		// int spans proj-x (two modules: fixture-b + fixture-c) and proj-y (one module).
		expect(intRow?.testCount).toBe(3);
		expect(intRow?.moduleCount).toBe(3);
		expect(intRow?.byProject.length).toBe(2);
		expect(intRow?.byProject.find((b) => b.project === "proj-x")?.testCount).toBe(2);
		expect(intRow?.byProject.find((b) => b.project === "proj-y")?.testCount).toBe(1);

		const slowRow = result.tags.find((t) => t.tag === "slow");
		// slow only appears on fixture-b.
		expect(slowRow?.testCount).toBe(1);
		expect(slowRow?.byProject.length).toBe(1);
		expect(slowRow?.byProject[0].project).toBe("proj-x");
	});

	test("inventory({ kind: 'tag', project }) scopes the inventory to a single project", async ({
		runtime,
		seeded: _seeded,
	}) => {
		const caller = makeCaller(runtime);
		const result = (await caller.inventory({ kind: "tag", project: "proj-y" })) as InventoryResultType;
		expect(result.inventoryKind).toBe("tag_scoped");
		if (result.inventoryKind !== "tag_scoped") return;
		expect(result.project).toBe("proj-y");
		// proj-y only carries the int tag.
		expect(result.count).toBe(1);
		expect(result.tags[0].tag).toBe("int");
		expect(result.tags[0].testCount).toBe(1);
	});

	test("test({ action: 'for_tag' }) unscoped groups int-tagged tests across both projects", async ({
		runtime,
		seeded: _seeded,
	}) => {
		const caller = makeCaller(runtime);
		const result = (await caller.test({ action: "for_tag", tag: "int" })) as TestResultType;
		expect(result.action).toBe("for_tag");
		if (result.action !== "for_tag") return;
		expect(result.count).toBe(3);
		expect(result.groups.length).toBe(2);
		const xGroup = result.groups.find((g) => g.project === "proj-x");
		expect(xGroup?.tests.map((t) => t.fullName).sort()).toEqual(["fixture-b > int slow b", "fixture-c > e2e int c"]);
		const yGroup = result.groups.find((g) => g.project === "proj-y");
		expect(yGroup?.tests[0].fullName).toBe("fixture-d > int d");
	});

	test("test({ action: 'for_tag', project }) scopes to a single project group", async ({
		runtime,
		seeded: _seeded,
	}) => {
		const caller = makeCaller(runtime);
		const result = (await caller.test({ action: "for_tag", tag: "e2e", project: "proj-x" })) as TestResultType;
		expect(result.action).toBe("for_tag");
		if (result.action !== "for_tag") return;
		expect(result.count).toBe(1);
		expect(result.groups.length).toBe(1);
		expect(result.groups[0].project).toBe("proj-x");
		expect(result.groups[0].tests[0].fullName).toBe("fixture-c > e2e int c");
	});

	test("inventory and for_tag are consistent — the per-tag count matches the for_tag result count", async ({
		runtime,
		seeded: _seeded,
	}) => {
		const caller = makeCaller(runtime);
		const inv = (await caller.inventory({ kind: "tag" })) as InventoryResultType;
		if (inv.inventoryKind !== "tag_unscoped") throw new Error("expected tag_unscoped");
		for (const tagRow of inv.tags) {
			const list = (await caller.test({ action: "for_tag", tag: tagRow.tag })) as TestResultType;
			if (list.action !== "for_tag") throw new Error("expected for_tag");
			expect(list.count).toBe(tagRow.testCount);
			// And the projects-per-tag match too
			expect(list.groups.map((g) => g.project).sort()).toEqual(tagRow.byProject.map((b) => b.project).sort());
		}
	});

	test("for_tag against an unknown tag returns count 0 and an empty groups array", async ({
		runtime,
		seeded: _seeded,
	}) => {
		const caller = makeCaller(runtime);
		const result = (await caller.test({ action: "for_tag", tag: "nonexistent" })) as TestResultType;
		expect(result.action).toBe("for_tag");
		if (result.action !== "for_tag") return;
		expect(result.count).toBe(0);
		expect(result.groups).toEqual([]);
	});
});
