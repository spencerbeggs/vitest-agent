import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore, OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { DataStoreTestLayer } from "./utils/layers.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));
const testRuntime = ManagedRuntime.make(TestLayer);

function createTestCaller(cwd: string = process.cwd(), initialSessionId: string | null = null) {
	const factory = createCallerFactory(appRouter);
	return factory({
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd,
		currentSessionId: createCurrentSessionIdRef(initialSessionId),
		sessionContext: createSessionContextRef(),
	});
}

async function seedTestData() {
	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;

			// Write settings
			yield* store.writeSettings(
				"abc123",
				{ vitestVersion: "3.2.0", pool: "forks", coverageProvider: "v8" },
				{ CI: "true", NODE_ENV: "test" },
			);

			// Write a test run
			const runId = yield* store.writeRun({
				invocationId: "inv-001",
				project: "default",
				settingsHash: "abc123",
				timestamp: "2026-03-25T10:00:00.000Z",
				commitSha: null,
				branch: null,
				reason: "passed",
				duration: 1200,
				total: 5,
				passed: 5,
				failed: 0,
				skipped: 0,
				scoped: false,
			});

			// Write a module
			const fileId = yield* store.ensureFile("src/utils.test.ts");
			const moduleIds = yield* store.writeModules(runId, [
				{
					fileId,
					relativeModuleId: "src/utils.test.ts",
					state: "passed",
					duration: 500,
				},
			]);

			// Write suites
			yield* store.writeSuites(moduleIds[0], [
				{
					name: "utils",
					fullName: "utils",
					state: "passed",
				},
			]);

			// Write test cases
			yield* store.writeTestCases(moduleIds[0], [
				{
					name: "adds numbers",
					fullName: "utils > adds numbers",
					state: "passed",
					duration: 10,
				},
				{
					name: "subtracts numbers",
					fullName: "utils > subtracts numbers",
					state: "passed",
					duration: 5,
				},
			]);

			// Write coverage
			const srcFileId = yield* store.ensureFile("src/utils.ts");
			yield* store.writeCoverage(runId, [
				{
					fileId: srcFileId,
					statements: 85.5,
					branches: 70.0,
					functions: 90.0,
					lines: 85.0,
					uncoveredLines: "42-50",
				},
			]);

			// Write trends
			yield* store.writeTrends("default", runId, {
				timestamp: "2026-03-25T10:00:00.000Z",
				coverage: { statements: 85.5, branches: 70.0, functions: 90.0, lines: 85.0 },
				delta: { statements: 1.0, branches: 0.5, functions: 0.0, lines: 1.0 },
				direction: "improving",
			});
		}),
	);
}

afterAll(async () => {
	await testRuntime.dispose();
});

describe("MCP Router", () => {
	it("help returns complete tool catalog", async () => {
		const caller = createTestCaller();
		const result = await caller.help();
		expect(result.helpText).toContain("vitest-agent MCP Tools");
		expect(result.helpText).toContain("test_status");
		expect(result.helpText).toContain("run_tests");
		expect(result.helpText).toContain("note");
		expect(result.helpText).toContain("Parameter Key");
	});

	it("help describes the T2 tag-filtering and tag-introspection surface", async () => {
		const caller = createTestCaller();
		const result = await caller.help();
		// run_tests describes the new tags + passWithNoTests inputs and the no-match discriminator
		expect(result.helpText).toContain("`tags?`");
		expect(result.helpText).toContain("`passWithNoTests?`");
		expect(result.helpText).toContain("no-match");
		// inventory advertises the new tag kind
		expect(result.helpText).toContain('kind: "tag"');
		expect(result.helpText).toContain("byProject");
		// test advertises the new for_tag action
		expect(result.helpText).toContain('action: "for_tag"');
	});

	it("test_status returns dataAvailable=false on empty DB", async () => {
		const caller = createTestCaller();
		const result = await caller.test_status({});
		expect(result.dataAvailable).toBe(false);
	});

	it("cache_health returns structured diagnostic on empty DB", async () => {
		const caller = createTestCaller();
		const result = (await caller.cache_health()) as { manifestPresent: boolean };
		expect(typeof result).toBe("object");
		// On an empty DB the manifest hasn't been written yet.
		expect(result.manifestPresent).toBe(false);
	});

	it("test_overview returns dataAvailable=false on empty DB", async () => {
		const caller = createTestCaller();
		const result = await caller.test_overview({});
		expect(result.dataAvailable).toBe(false);
	});

	it("configure returns structured settings when no hash provided", async () => {
		await seedTestData();
		const caller = createTestCaller();
		const result = (await caller.configure({})) as {
			found: boolean;
			source: string;
			settings?: { hash: string };
		};
		expect(typeof result).toBe("object");
		expect(result.found).toBe(true);
		expect(result.source).toBe("latest");
		expect(result.settings?.hash).toBe("abc123");
	});

	it("note CRUD lifecycle", async () => {
		const caller = createTestCaller();

		// Create
		const created = await caller.note({
			action: "create",
			title: "Test Note",
			content: "Some content",
			scope: "global",
		});
		const id = (created as { id: number }).id;
		expect(id).toBeGreaterThan(0);

		// Read
		const note = (await caller.note({ action: "get", id })) as {
			found: boolean;
			note?: { title: string };
		};
		expect(note.found).toBe(true);
		if (note.found && note.note) expect(note.note.title).toBe("Test Note");

		// Update
		await caller.note({ action: "update", id, title: "Updated" });
		const updated = (await caller.note({ action: "get", id })) as {
			found: boolean;
			note?: { title: string };
		};
		expect(updated.found).toBe(true);
		if (updated.found && updated.note) expect(updated.note.title).toBe("Updated");

		// Delete
		await caller.note({ action: "delete", id });
		const deleted = (await caller.note({ action: "get", id })) as { found: boolean };
		expect(deleted.found).toBe(false);
	});

	it("note list returns count=0 and an empty notes[] for an empty filter", async () => {
		// Use a scope filter that won't match any notes
		const caller = createTestCaller();
		const result = (await caller.note({ action: "list", scope: "test", testFullName: "nonexistent" })) as {
			action: string;
			count: number;
			notes: ReadonlyArray<unknown>;
		};
		expect(result.action).toBe("list");
		expect(result.count).toBe(0);
		expect(result.notes).toEqual([]);
	});

	it("note list returns the matching notes structurally when notes exist", async () => {
		const caller = createTestCaller();
		await caller.note({ action: "create", title: "Table Note", content: "Content for table test", scope: "global" });
		const result = (await caller.note({ action: "list" })) as {
			action: string;
			count: number;
			notes: ReadonlyArray<{ title: string }>;
		};
		expect(result.action).toBe("list");
		expect(result.count).toBeGreaterThan(0);
		expect(result.notes.some((n) => n.title === "Table Note")).toBe(true);
	});

	it("note search returns count=0 and an empty notes[] when no rows match", async () => {
		const caller = createTestCaller();
		const result = (await caller.note({ action: "search", query: "nonexistentkeyword999" })) as {
			action: string;
			query: string;
			count: number;
			notes: ReadonlyArray<unknown>;
		};
		expect(result.action).toBe("search");
		expect(result.query).toBe("nonexistentkeyword999");
		expect(result.count).toBe(0);
	});

	it("note search returns the matching notes structurally", async () => {
		const caller = createTestCaller();
		await caller.note({
			action: "create",
			title: "Searchable Note",
			content: "This contains unique keyword xylophone",
			scope: "global",
		});
		const result = (await caller.note({ action: "search", query: "xylophone" })) as {
			action: string;
			query: string;
			count: number;
			notes: ReadonlyArray<{ title: string }>;
		};
		expect(result.action).toBe("search");
		expect(result.query).toBe("xylophone");
		expect(result.count).toBeGreaterThan(0);
		expect(result.notes.some((n) => n.title === "Searchable Note")).toBe(true);
	});

	it("test for_file returns count=0 and an empty testFiles[] for unknown file", async () => {
		const caller = createTestCaller();
		const result = await caller.test({ action: "for_file", filePath: "nonexistent.ts" });
		expect(result.action).toBe("for_file");
		if (result.action === "for_file") {
			expect(result.count).toBe(0);
			expect(result.testFiles).toEqual([]);
		}
	});

	it("test_coverage returns coverage data after seeding", async () => {
		const caller = createTestCaller();
		const result = await caller.test_coverage({ project: "default" });
		expect(result.dataAvailable).toBe(true);
		if (result.dataAvailable) {
			expect(result.project).toBe("default");
			expect(result.coverage.totals.statements).toBeGreaterThanOrEqual(0);
		}
	});

	it("run_tests returns a structured ok | timeout | error envelope", { timeout: 30_000 }, async () => {
		// Anchor at an empty tempdir so the nested vitest invocation does not
		// pick up this monorepo's vitest.config.ts (which would re-load the
		// AgentPlugin and contend with the outer reporter on the same DB).
		const isolated = mkdtempSync(join(tmpdir(), "vitest-agent-run-tests-"));
		try {
			const caller = createTestCaller(isolated);
			const result = await caller.run_tests({ files: ["nonexistent.test.ts"], timeout: 5 });
			expect(["ok", "timeout", "error"]).toContain(result.kind);
		} finally {
			rmSync(isolated, { recursive: true, force: true });
		}
	});

	it("inventory project returns the inventoryKind discriminant", async () => {
		const caller = createTestCaller();
		const result = await caller.inventory({ kind: "project" });
		expect(result.inventoryKind).toBe("project");
	});

	it("test list returns a structured groups envelope", async () => {
		const caller = createTestCaller();
		const result = await caller.test({ action: "list", project: "default" });
		expect(result.action).toBe("list");
	});

	it("inventory module returns the inventoryKind discriminant", async () => {
		const caller = createTestCaller();
		const result = await caller.inventory({ kind: "module", project: "default" });
		expect(result.inventoryKind).toBe("module");
	});

	it("inventory suite returns the inventoryKind discriminant", async () => {
		const caller = createTestCaller();
		const result = await caller.inventory({ kind: "suite", project: "default" });
		expect(result.inventoryKind).toBe("suite");
	});

	it("settings_list returns count and the captured settings rows", async () => {
		const caller = createTestCaller();
		const result = await caller.settings_list({});
		expect(result.count).toBeGreaterThan(0);
		expect(result.settings[0]?.hash.length).toBeGreaterThan(0);
	});

	it("test get returns the structured test row for a known test", async () => {
		const caller = createTestCaller();
		const result = await caller.test({ action: "get", fullName: "utils > adds numbers", project: "default" });
		expect(result.action).toBe("get");
		if (result.action === "get" && result.found) {
			expect(result.test.fullName).toBe("utils > adds numbers");
			expect(result.test.state).toBe("passed");
			expect(result.test.module).toBe("src/utils.test.ts");
		}
	});

	it("test get returns found=false for an unknown test", async () => {
		const caller = createTestCaller();
		const result = await caller.test({ action: "get", fullName: "nonexistent > test", project: "default" });
		expect(result.action).toBe("get");
		if (result.action === "get") expect(result.found).toBe(false);
	});

	it("file_coverage returns dataAvailable=true for the tracked project", async () => {
		const caller = createTestCaller();
		const result = await caller.file_coverage({ filePath: "src/utils.ts", project: "default" });
		expect(result.dataAvailable).toBe(true);
		if (result.dataAvailable) expect(result.filePath).toBe("src/utils.ts");
	});

	it("file_coverage returns matched=false for an unknown file", async () => {
		const caller = createTestCaller();
		const result = await caller.file_coverage({ filePath: "nonexistent.ts", project: "default" });
		expect(result.dataAvailable).toBe(true);
		if (result.dataAvailable) {
			expect(result.matched).toBe(false);
			expect(result.filePath).toBe("nonexistent.ts");
		}
	});

	describe("hypothesis_record and hypothesis_validate", () => {
		it("hypothesis_record creates a hypothesis and returns { id }", async () => {
			// Seed a session so the FK resolves
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						chatId: "cc-hyp-record-test",
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: new Date().toISOString(),
					});
				}),
			);

			const caller = createTestCaller();
			const first = await caller.hypothesis({
				action: "record",
				sessionId,
				content: "The failure is caused by a missing null guard in the parser.",
			});

			expect(first).toHaveProperty("id");
			expect((first as { id: number }).id).toBeGreaterThan(0);

			// Second call with the same args writes a new row. (Idempotency
			// middleware no longer wraps the consolidated tool — a follow-up
			// can re-add it once the discriminator union surface stabilizes.)
			const second = await caller.hypothesis({
				action: "record",
				sessionId,
				content: "The failure is caused by a missing null guard in the parser.",
			});
			expect((second as { id: number }).id).toBeGreaterThan(0);
		});

		it("hypothesis_record binds to the main session's active subagent child, not the caller value", async () => {
			// Seed a main session and an active (un-ended) subagent child.
			const { mainId, subId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const mainId = yield* store.writeSession({
						chatId: "cc-hyp-resolve-main",
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: "2026-05-01T00:00:00Z",
					});
					const subId = yield* store.writeSession({
						chatId: "cc-hyp-resolve-main-subagent-1-1",
						project: "default",
						cwd: process.cwd(),
						agentKind: "subagent",
						agentType: "tdd-task",
						parentSessionId: mainId,
						startedAt: "2026-05-01T00:01:00Z",
					});
					return { mainId, subId };
				}),
			);

			// The single-process MCP server's recovered context always names the
			// MAIN agent. The caller passes NO sessionId — the tool must resolve
			// the running subagent child server-side.
			const factory = createCallerFactory(appRouter);
			const caller = factory({
				runtime: testRuntime as unknown as McpContext["runtime"],
				cwd: process.cwd(),
				currentSessionId: createCurrentSessionIdRef(),
				sessionContext: createSessionContextRef({
					chatId: "cc-hyp-resolve-main",
					conversationId: "conv-resolve-1",
					mainAgentId: "agent-resolve-1",
				}),
			});

			const recorded = await caller.hypothesis({
				action: "record",
				content: "clamp ignores inverted bounds; a min>max guard will fix it.",
			});
			expect((recorded as { id: number }).id).toBeGreaterThan(0);

			// The hypothesis is findable by the SUBAGENT session id (the
			// seven-step audit query), and is NOT bound to the parent main.
			const underSub = await caller.hypothesis({ action: "list", sessionId: subId });
			expect((underSub as { count: number }).count).toBe(1);
			const underMain = await caller.hypothesis({ action: "list", sessionId: mainId });
			expect((underMain as { count: number }).count).toBe(0);
		});

		it("hypothesis_record binds via tddTaskId to the task's session, with no recovered context", async () => {
			// Seed a session and a TDD task opened under it. No host context
			// is recovered (default caller has an empty sessionContext), so
			// the ONLY way to attribute the hypothesis is the tddTaskId.
			const { sessionId, tddTaskId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sessionId = yield* store.writeSession({
						chatId: "cc-hyp-tddtask-a",
						project: "default",
						cwd: process.cwd(),
						agentKind: "subagent",
						agentType: "tdd-task",
						startedAt: "2026-05-02T00:00:00Z",
					});
					const tddTaskId = yield* store.writeTddTask({
						sessionId,
						goal: "obj",
						startedAt: "2026-05-02T00:00:01Z",
					});
					return { sessionId, tddTaskId };
				}),
			);

			const caller = createTestCaller();
			const recorded = await caller.hypothesis({
				action: "record",
				tddTaskId,
				content: "the reducer drops the last event; flush on unmount fixes it.",
			});
			expect((recorded as { id: number }).id).toBeGreaterThan(0);

			const underSession = await caller.hypothesis({ action: "list", sessionId });
			expect((underSession as { count: number }).count).toBe(1);
		});

		it("hypothesis_record tddTaskId takes precedence over a set recovered context", async () => {
			// Seed BOTH: (1) a TDD task under its own session, and (2) an
			// unrelated main session with an active subagent child that the
			// recovered context (sc) would otherwise resolve to. The
			// tddTaskId must win and bind to the task's session, ignoring sc.
			const { taskSessionId, mainId, subId, tddTaskId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const taskSessionId = yield* store.writeSession({
						chatId: "cc-hyp-tddtask-b",
						project: "default",
						cwd: process.cwd(),
						agentKind: "subagent",
						agentType: "tdd-task",
						startedAt: "2026-05-03T00:00:00Z",
					});
					const tddTaskId = yield* store.writeTddTask({
						sessionId: taskSessionId,
						goal: "obj",
						startedAt: "2026-05-03T00:00:01Z",
					});
					const mainId = yield* store.writeSession({
						chatId: "cc-hyp-tddtask-b-main",
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: "2026-05-03T00:00:02Z",
					});
					const subId = yield* store.writeSession({
						chatId: "cc-hyp-tddtask-b-main-subagent-1-1",
						project: "default",
						cwd: process.cwd(),
						agentKind: "subagent",
						agentType: "tdd-task",
						parentSessionId: mainId,
						startedAt: "2026-05-03T00:00:03Z",
					});
					return { taskSessionId, mainId, subId, tddTaskId };
				}),
			);

			const factory = createCallerFactory(appRouter);
			const caller = factory({
				runtime: testRuntime as unknown as McpContext["runtime"],
				cwd: process.cwd(),
				currentSessionId: createCurrentSessionIdRef(),
				sessionContext: createSessionContextRef({
					chatId: "cc-hyp-tddtask-b-main",
					conversationId: "conv-precedence-1",
					mainAgentId: "agent-precedence-1",
				}),
			});

			const recorded = await caller.hypothesis({
				action: "record",
				tddTaskId,
				content: "off-by-one in the range clamp; inclusive upper bound fixes it.",
			});
			expect((recorded as { id: number }).id).toBeGreaterThan(0);

			// Bound to the task's session, NOT the sc-resolved subagent/main.
			const underTask = await caller.hypothesis({ action: "list", sessionId: taskSessionId });
			expect((underTask as { count: number }).count).toBe(1);
			const underSub = await caller.hypothesis({ action: "list", sessionId: subId });
			expect((underSub as { count: number }).count).toBe(0);
			const underMain = await caller.hypothesis({ action: "list", sessionId: mainId });
			expect((underMain as { count: number }).count).toBe(0);
		});

		it("hypothesis_record fails with a typed error for an unknown tddTaskId", async () => {
			const caller = createTestCaller();
			await expect(
				caller.hypothesis({
					action: "record",
					tddTaskId: 987654,
					content: "this should never be written.",
				}),
			).rejects.toThrow(/unknown tddTaskId 987654/);
		});

		it("hypothesis_record accepts a stringified tddTaskId and binds to the same session as the numeric form", async () => {
			// Regression guard: LLM orchestrators routinely stringify numeric
			// tool inputs. A real dogfood run passed `tddTaskId: "5"` (a
			// string), which the former `Schema.Number` field REJECTED — the
			// deterministic tddTaskId branch never ran and the hypothesis was
			// misattributed. The field now coerces a numeric string to a
			// number, so the string form must resolve via
			// getSessionByTddTaskId exactly like the numeric form, ignoring
			// the (absent) host context.
			const { sessionId, tddTaskId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sessionId = yield* store.writeSession({
						chatId: "cc-hyp-tddtask-str",
						project: "default",
						cwd: process.cwd(),
						agentKind: "subagent",
						agentType: "tdd-task",
						startedAt: "2026-05-04T00:00:00Z",
					});
					const tddTaskId = yield* store.writeTddTask({
						sessionId,
						goal: "obj",
						startedAt: "2026-05-04T00:00:01Z",
					});
					return { sessionId, tddTaskId };
				}),
			);

			const caller = createTestCaller();
			const recorded = await caller.hypothesis({
				action: "record",
				// Passed as a STRING, the exact shape the dogfood orchestrator sent.
				tddTaskId: String(tddTaskId),
				content: "stringified tddTaskId must bind the same as the numeric form.",
			});
			expect((recorded as { id: number }).id).toBeGreaterThan(0);

			const underSession = await caller.hypothesis({ action: "list", sessionId });
			expect((underSession as { count: number }).count).toBe(1);
		});

		it("hypothesis_record accepts a stringified sessionId in the fallback path", async () => {
			// With no recovered host context, the caller-supplied sessionId is
			// honored (dev / tests). It, too, must accept a numeric string.
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						chatId: "cc-hyp-sessionid-str",
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: "2026-05-04T01:00:00Z",
					});
				}),
			);

			const caller = createTestCaller();
			const recorded = await caller.hypothesis({
				action: "record",
				sessionId: String(sessionId),
				content: "stringified sessionId fallback must bind.",
			});
			expect((recorded as { id: number }).id).toBeGreaterThan(0);

			const underSession = await caller.hypothesis({ action: "list", sessionId });
			expect((underSession as { count: number }).count).toBe(1);
		});

		it("hypothesis_record rejects a non-numeric string tddTaskId (no silent NaN/0 coercion)", async () => {
			// FiniteFromString rejects NaN, so a genuinely non-numeric string
			// fails validation rather than coercing to NaN (or 0) and slipping
			// through as a bogus id.
			const caller = createTestCaller();
			await expect(
				caller.hypothesis({
					action: "record",
					tddTaskId: "abc",
					content: "this should never be written.",
				}),
			).rejects.toThrow();
		});

		it("hypothesis validate updates the validation outcome to confirmed", async () => {
			// Seed session + hypothesis
			const { hypothesisId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sessionId = yield* store.writeSession({
						chatId: "cc-hyp-validate-test",
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: new Date().toISOString(),
					});
					const hypothesisId = yield* store.writeHypothesis({
						sessionId,
						content: "Race condition in the event loop.",
					});
					return { hypothesisId };
				}),
			);

			const caller = createTestCaller();
			const result = await caller.hypothesis({
				action: "validate",
				id: hypothesisId,
				outcome: "confirmed",
				validatedAt: new Date().toISOString(),
			});

			expect(result).toEqual({ action: "validate" });
		});

		it("hypothesis validate returns error for unknown hypothesis id", async () => {
			const caller = createTestCaller();
			await expect(
				caller.hypothesis({
					action: "validate",
					id: 999999,
					outcome: "refuted",
					validatedAt: new Date().toISOString(),
				}),
			).rejects.toThrow();
		});
	});

	describe("triage_brief tool", () => {
		it("renders either the cold-start hint or a real triage brief depending on prior seeding", async () => {
			const caller = createTestCaller();
			const result = await caller.triage_brief({});
			// The shared runtime may carry seed data from prior tests, so
			// either branch of `hasContent` is acceptable; we assert the
			// markdown body matches one of the two expected shapes.
			expect(result.markdown).toMatch(/No orientation signal|orientation triage|Recent Test Runs/i);
		});

		it("includes content when test runs are seeded", async () => {
			const caller = createTestCaller();
			await seedTestData();
			const result = await caller.triage_brief({});
			expect(result.hasContent).toBe(true);
			expect(result.markdown.length).toBeGreaterThan(0);
		});
	});

	describe("test_history tool", () => {
		it("keeps two recovered tests with the same fullName in different modules distinguishable by modulePath", async () => {
			const store = await testRuntime.runPromise(Effect.map(DataStore, (s) => s));

			await testRuntime.runPromise(
				Effect.gen(function* () {
					yield* store.writeSettings("history-recovered-hash", { vitestVersion: "3.2.0" }, {});
					const runId = yield* store.writeRun({
						invocationId: "inv-history-recovered",
						project: "history-recovered-proj",
						settingsHash: "history-recovered-hash",
						timestamp: "2026-03-26T00:00:00.000Z",
						commitSha: null,
						branch: null,
						reason: "passed",
						duration: 100,
						total: 2,
						passed: 2,
						failed: 0,
						skipped: 0,
						scoped: false,
					});

					// Two distinct files sharing a describe+test name; each recovers
					// from a failure to a pass -- the "recovered" listing must keep
					// them as two distinguishable entries, not one collapsed row.
					yield* store.writeHistory(
						"history-recovered-proj",
						"Suite > shared name",
						"src/a.test.ts",
						runId,
						"2026-03-25T00:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"boom A",
					);
					yield* store.writeHistory(
						"history-recovered-proj",
						"Suite > shared name",
						"src/a.test.ts",
						runId,
						"2026-03-26T00:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"history-recovered-proj",
						"Suite > shared name",
						"src/b.test.ts",
						runId,
						"2026-03-25T00:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"boom B",
					);
					yield* store.writeHistory(
						"history-recovered-proj",
						"Suite > shared name",
						"src/b.test.ts",
						runId,
						"2026-03-26T00:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
				}),
			);

			const caller = createTestCaller();
			const result = await caller.test_history({ project: "history-recovered-proj" });

			expect(result.history.tests).toHaveLength(2);
			const moduleAEntry = result.history.tests.find((t) => t.modulePath === "src/a.test.ts");
			const moduleBEntry = result.history.tests.find((t) => t.modulePath === "src/b.test.ts");
			expect(moduleAEntry?.fullName).toBe("Suite > shared name");
			expect(moduleBEntry?.fullName).toBe("Suite > shared name");

			expect(result.recovered).toHaveLength(2);
			const recoveredA = result.recovered.find((r) => r.modulePath === "src/a.test.ts");
			const recoveredB = result.recovered.find((r) => r.modulePath === "src/b.test.ts");
			expect(recoveredA).toBeDefined();
			expect(recoveredB).toBeDefined();
			expect(recoveredA?.fullName).toBe("Suite > shared name");
			expect(recoveredB?.fullName).toBe("Suite > shared name");
			// recentRuns is oldest-first; each module recovered failed -> passed.
			expect(recoveredA?.recentRuns).toEqual(["failed", "passed"]);
			expect(recoveredB?.recentRuns).toEqual(["failed", "passed"]);
		});
	});

	describe("wrapup_prompt tool", () => {
		it("returns hasContent=false for an unknown session", async () => {
			const caller = createTestCaller();
			const result = await caller.wrapup_prompt({});
			expect(result.hasContent).toBe(false);
			expect(result.markdown).toMatch(/Nothing to wrap up|no recent activity/i);
		});

		it("emits a failure-prompt nudge for the user_prompt_nudge variant", async () => {
			const caller = createTestCaller();
			const result = await caller.wrapup_prompt({
				kind: "user_prompt_nudge",
				userPromptHint: "fix the broken test in foo.test.ts",
			});
			expect(result.kind).toBe("user_prompt_nudge");
			expect(result.markdown).toContain("test_history");
			expect(result.markdown).toContain("failure_signature_get");
		});
	});

	describe("tdd_session_start tool", () => {
		it("inserts on first call and replays on second", async () => {
			// Seed a session so the FK resolves.
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						chatId: "cc-tdd-start-test",
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: new Date().toISOString(),
					});
				}),
			);

			const caller = createTestCaller();
			const r1 = await caller.tdd_task({ action: "start", sessionId, goal: "add login" });
			const r2 = await caller.tdd_task({ action: "start", sessionId, goal: "add login" });
			expect((r1 as { tddTaskId: number }).tddTaskId).toBe((r2 as { tddTaskId: number }).tddTaskId);
			expect((r2 as { _idempotentReplay?: boolean })._idempotentReplay).toBe(true);
		});
	});

	describe("tdd_session_end tool", () => {
		it("ends a TDD session with the given outcome and replays on duplicate", async () => {
			// Seed a session so the FK resolves, then start a TDD session under it.
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						chatId: "cc-tdd-end-test",
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: new Date().toISOString(),
					});
				}),
			);

			const caller = createTestCaller();
			const created = await caller.tdd_task({ action: "start", sessionId, goal: "ending-test" });
			const r1 = await caller.tdd_task({
				action: "end",
				tddTaskId: (created as { tddTaskId: number }).tddTaskId,
				outcome: "succeeded",
			});
			const r2 = await caller.tdd_task({
				action: "end",
				tddTaskId: (created as { tddTaskId: number }).tddTaskId,
				outcome: "succeeded",
			});
			expect((r1 as { outcome: string }).outcome).toBe("succeeded");
			expect((r2 as { _idempotentReplay?: boolean })._idempotentReplay).toBe(true);
		});
	});

	describe("commit_changes tool", () => {
		it("returns count=0 and an empty commits[] on empty DB", async () => {
			const caller = createTestCaller();
			const r = (await caller.commit_changes({})) as { count: number; commits: ReadonlyArray<unknown> };
			expect(r.count).toBe(0);
			expect(r.commits).toEqual([]);
		});
	});

	describe("tdd_task resume", () => {
		it("returns the structured resume envelope for an existing TDD task", async () => {
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						chatId: "cc-tdd-resume-test",
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: new Date().toISOString(),
					});
				}),
			);
			const caller = createTestCaller();
			const tdd = await caller.tdd_task({ action: "start", sessionId, goal: "resume-test" });
			const tddId = (tdd as { tddTaskId: number }).tddTaskId;
			const out = await caller.tdd_task({ action: "resume", tddTaskId: tddId });
			expect(out.action).toBe("resume");
			if (out.action === "resume" && out.found) {
				expect(out.tddTaskId).toBe(tddId);
				expect(out.goal).toBe("resume-test");
			}
		});

		it("returns found=false for an unknown id", async () => {
			const caller = createTestCaller();
			const out = await caller.tdd_task({ action: "resume", tddTaskId: 99999 });
			expect(out.action).toBe("resume");
			if (out.action === "resume") expect(out.found).toBe(false);
		});
	});

	describe("tdd_task get includes a current-phase line with phaseId", () => {
		it("renders 'current phase: <name> [phaseId=N]' so the orchestrator can cite it", async () => {
			const { sessionId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sid = yield* store.writeSession({
						chatId: "cc-tdd-get-current-phase",
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: new Date().toISOString(),
					});
					return { sessionId: sid };
				}),
			);
			const caller = createTestCaller();
			const tdd = (await caller.tdd_task({ action: "start", sessionId, goal: "current-phase-test" })) as {
				tddTaskId: number;
			};
			const out = await caller.tdd_task({ action: "get", tddTaskId: tdd.tddTaskId });
			expect(out.action).toBe("get");
			if (out.action === "get" && out.found) {
				expect(out.currentPhase?.phase).toBe("spike");
				expect(typeof out.currentPhase?.id).toBe("number");
			}
		});
	});

	describe("tdd_artifact_list tool", () => {
		let seedCounter = 0;
		async function seedSessionWithArtifacts(): Promise<{
			tddId: number;
			spikePhaseId: number;
			redPhaseId: number;
			testFailedRunArtifactId: number;
			codeWrittenArtifactId: number;
		}> {
			const chatId = `cc-art-list-test-${++seedCounter}`;
			return testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sessionId = yield* store.writeSession({
						chatId: chatId,
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: new Date().toISOString(),
					});
					const tddId = yield* store.writeTddTask({
						sessionId,
						goal: "artifact-list-test",
						startedAt: new Date().toISOString(),
					});
					const spike = yield* store.writeTddPhase({
						tddTaskId: tddId,
						phase: "spike",
						startedAt: "2026-04-30T00:00:00Z",
					});
					const red = yield* store.writeTddPhase({
						tddTaskId: tddId,
						phase: "red",
						startedAt: "2026-04-30T00:01:00Z",
					});
					yield* store.writeTddArtifact({
						phaseId: spike.id,
						artifactKind: "test_written",
						recordedAt: "2026-04-30T00:00:30Z",
					});
					const failedRun = yield* store.writeTddArtifact({
						phaseId: red.id,
						artifactKind: "test_failed_run",
						recordedAt: "2026-04-30T00:01:30Z",
					});
					const codeWritten = yield* store.writeTddArtifact({
						phaseId: red.id,
						artifactKind: "code_written",
						recordedAt: "2026-04-30T00:02:00Z",
					});
					return {
						tddId,
						spikePhaseId: spike.id,
						redPhaseId: red.id,
						testFailedRunArtifactId: failedRun,
						codeWrittenArtifactId: codeWritten,
					};
				}),
			);
		}

		it("returns the recorded artifacts in newest-first order", async () => {
			const seeded = await seedSessionWithArtifacts();
			const caller = createTestCaller();
			const out = await caller.tdd_artifact_list({ tddTaskId: seeded.tddId });
			expect(out.tddTaskId).toBe(seeded.tddId);
			expect(out.count).toBe(3);
			expect(out.artifacts[0].artifactKind).toBe("code_written");
			expect(out.artifacts[0].id).toBe(seeded.codeWrittenArtifactId);
			expect(out.artifacts[1].artifactKind).toBe("test_failed_run");
			expect(out.artifacts[2].artifactKind).toBe("test_written");
			expect(out.artifacts[0].phaseId).toBe(seeded.redPhaseId);
		});

		it("filters by artifactKind", async () => {
			const seeded = await seedSessionWithArtifacts();
			const caller = createTestCaller();
			const out = await caller.tdd_artifact_list({
				tddTaskId: seeded.tddId,
				artifactKind: "test_failed_run",
			});
			expect(out.count).toBe(1);
			expect(out.artifacts[0].id).toBe(seeded.testFailedRunArtifactId);
			expect(out.filters.artifactKind).toBe("test_failed_run");
		});

		it("returns count=0 and an empty artifacts[] when there is no match", async () => {
			const seeded = await seedSessionWithArtifacts();
			const caller = createTestCaller();
			const out = await caller.tdd_artifact_list({
				tddTaskId: seeded.tddId,
				artifactKind: "refactor",
			});
			expect(out.count).toBe(0);
			expect(out.artifacts).toEqual([]);
			expect(out.filters.artifactKind).toBe("refactor");
		});
	});

	describe("tdd_phase_transition_request tool", () => {
		async function seedTddSessionForTransition(
			chatId: string,
			goalText: string,
		): Promise<{ tddId: number; goalId: number; sessionId: number }> {
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						chatId: chatId,
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: new Date().toISOString(),
					});
				}),
			);
			const caller = createTestCaller();
			const tdd = await caller.tdd_task({ action: "start", sessionId, goal: goalText });
			const tddId = (tdd as { tddTaskId: number }).tddTaskId;
			const goalRes = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: goalText })) as {
				ok: true;
				goal: { id: number };
			};
			await caller.tdd_goal({ action: "update", id: goalRes.goal.id, status: "in_progress" });
			return { tddId, goalId: goalRes.goal.id, sessionId };
		}

		it("rejects with missing_artifact_evidence when cited artifact does not exist", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-missing", "g");
			const caller = createTestCaller();
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				requestedPhase: "green",
				citedArtifactId: 99999,
			})) as { accepted: boolean; denialReason?: string };
			expect(r.accepted).toBe(false);
			if (r.accepted === false) {
				expect(r.denialReason).toBe("missing_artifact_evidence");
			}
		});

		it("accepts spike→red unconditionally (entry-point transition)", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-accept", "g2");

			const { artifactId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const phase = yield* store.writeTddPhase({
						tddTaskId: tddId,
						phase: "spike",
						startedAt: new Date().toISOString(),
					});
					const artifactId = yield* store.writeTddArtifact({
						phaseId: phase.id,
						artifactKind: "test_written",
						recordedAt: new Date().toISOString(),
					});
					return { artifactId };
				}),
			);

			const caller = createTestCaller();
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				requestedPhase: "red",
				citedArtifactId: artifactId,
			})) as { accepted: boolean };
			expect(r.accepted).toBe(true);
		});

		it("rejects with goal_not_found when goalId does not exist", async () => {
			const { tddId } = await seedTddSessionForTransition("cc-tdd-trans-goalmissing", "g");
			const caller = createTestCaller();
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId: 99999,
				requestedPhase: "red",
				citedArtifactId: 1,
			})) as { accepted: boolean; denialReason?: string };
			expect(r.accepted).toBe(false);
			expect((r as { denialReason: string }).denialReason).toBe("goal_not_found");
		});

		it("rejects with goal_not_in_progress when goal status is done", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-goaldone", "g");
			const caller = createTestCaller();
			await caller.tdd_goal({ action: "update", id: goalId, status: "done" });
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				requestedPhase: "red",
				citedArtifactId: 1,
			})) as { accepted: boolean; denialReason?: string };
			expect(r.accepted).toBe(false);
			expect((r as { denialReason: string }).denialReason).toBe("goal_not_in_progress");
		});

		it("rejects with behavior_not_found when behaviorId does not exist", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-behmissing", "g");
			const caller = createTestCaller();
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				behaviorId: 99999,
				requestedPhase: "red",
				citedArtifactId: 1,
			})) as { accepted: boolean; denialReason?: string };
			expect(r.accepted).toBe(false);
			expect((r as { denialReason: string }).denialReason).toBe("behavior_not_found");
		});

		it("rejects with behavior_not_in_goal when behavior belongs to a different goal", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-othergoal", "g");
			const caller = createTestCaller();
			const otherGoal = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "other" })) as {
				ok: true;
				goal: { id: number };
			};
			const otherBeh = (await caller.tdd_behavior({ action: "create", goalId: otherGoal.goal.id, behavior: "x" })) as {
				ok: true;
				behavior: { id: number };
			};
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				behaviorId: otherBeh.behavior.id,
				requestedPhase: "red",
				citedArtifactId: 1,
			})) as { accepted: boolean; denialReason?: string };
			expect(r.accepted).toBe(false);
			expect((r as { denialReason: string }).denialReason).toBe("behavior_not_in_goal");
		});

		it("auto-promotes behavior pending → in_progress on accepted transition", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-autopromote", "g");
			const caller = createTestCaller();
			const beh = (await caller.tdd_behavior({ action: "create", goalId, behavior: "b1" })) as {
				ok: true;
				behavior: { id: number; status: string };
			};
			expect(beh.behavior.status).toBe("pending");

			const { artifactId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const phase = yield* store.writeTddPhase({
						tddTaskId: tddId,
						phase: "spike",
						startedAt: new Date().toISOString(),
					});
					const artifactId = yield* store.writeTddArtifact({
						phaseId: phase.id,
						artifactKind: "test_written",
						recordedAt: new Date().toISOString(),
					});
					return { artifactId };
				}),
			);

			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				behaviorId: beh.behavior.id,
				requestedPhase: "red",
				citedArtifactId: artifactId,
			})) as { accepted: boolean };
			expect(r.accepted).toBe(true);

			const updated = (await caller.tdd_behavior({ action: "get", id: beh.behavior.id })) as {
				found: true;
				behavior: { status: string };
			};
			expect(updated.behavior.status).toBe("in_progress");
		});

		it("auto-promotes behavior pending → in_progress when accepted with behaviorId and requestedPhase 'green' (red→green path)", async () => {
			const phaseStartedAt = new Date().toISOString();
			// sessionId is the sessions.id for the Claude Code session that owns the TDD session.
			// The turn written for test_case_authored_in_session must belong to this same session.
			const { tddId, goalId, sessionId } = await seedTddSessionForTransition("cc-tdd-trans-green-autopromote", "g");
			const caller = createTestCaller();

			// Create a behavior — must start as pending.
			const beh = (await caller.tdd_behavior({ action: "create", goalId, behavior: "green-b1" })) as {
				ok: true;
				behavior: { id: number; status: string };
			};
			expect(beh.behavior.status).toBe("pending");

			// Seed a red phase + test_failed_run artifact that satisfies all D2 binding rules:
			//   - test_case_id is non-null (rule 1 requires an anchor)
			//   - test_case_authored_in_session = true (turn.session_id === sessions.id for TDD session)
			//   - test_case_created_turn_at >= phase_started_at (in-window)
			//   - artifact behavior_id matches the requested behavior (rule 2, via tdd_phases.behavior_id)
			//   - test_first_failure_run_id === test_run_id (rule 3: test wasn't pre-existing)
			const { artifactId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;

					// sessionId is already the sessions.id for the Claude Code session the TDD
					// session belongs to. We use it directly so test_case_authored_in_session
					// resolves to true (turn.session_id === sessions.id via the TDD → session FK).

					// Write a turn in that session to anchor the test case.
					const turnOccurredAt = new Date(new Date(phaseStartedAt).getTime() + 100).toISOString();
					const turnId = yield* store.writeTurn({
						sessionId: sessionId,
						type: "file_edit",
						payload: JSON.stringify({
							type: "file_edit",
							file_path: "src/example.test.ts",
							edit_kind: "write",
						}),
						occurredAt: turnOccurredAt,
					});

					// Write a test run.
					yield* store.writeSettings("hash-green-test", { vitestVersion: "4.1.0" }, {});
					const runId = yield* store.writeRun({
						invocationId: "inv-green-001",
						project: "default",
						settingsHash: "hash-green-test",
						timestamp: turnOccurredAt,
						commitSha: null,
						branch: null,
						reason: "failed",
						duration: 500,
						total: 1,
						passed: 0,
						failed: 1,
						skipped: 0,
						scoped: false,
					});

					// Write a test module and a test case with created_turn_id linking to
					// the turn in the same session.
					const fileId = yield* store.ensureFile("src/example.test.ts");
					const [moduleId] = yield* store.writeModules(runId, [
						{
							fileId,
							relativeModuleId: "src/example.test.ts",
							state: "failed",
							duration: 200,
						},
					]);
					const [testCaseId] = yield* store.writeTestCases(moduleId, [
						{
							name: "should do something",
							fullName: "example > should do something",
							state: "failed",
							duration: 10,
							createdTurnId: turnId,
						},
					]);

					// Open a red phase with the behavior_id — the validator reads
					// tdd_phases.behavior_id to enforce D2 binding rule 2.
					const redPhase = yield* store.writeTddPhase({
						tddTaskId: tddId,
						behaviorId: beh.behavior.id,
						phase: "red",
						startedAt: phaseStartedAt,
					});

					// Write the test_failed_run artifact.
					// test_first_failure_run_id === test_run_id satisfies D2 rule 3.
					const artifactId = yield* store.writeTddArtifact({
						phaseId: redPhase.id,
						artifactKind: "test_failed_run",
						testCaseId,
						testRunId: runId,
						testFirstFailureRunId: runId,
						recordedAt: turnOccurredAt,
					});

					return { artifactId };
				}),
			);

			// The behavior is still pending before the transition.
			const before = (await caller.tdd_behavior({ action: "get", id: beh.behavior.id })) as {
				found: true;
				behavior: { status: string };
			};
			expect(before.behavior.status).toBe("pending");

			// Request red→green — this should be accepted and auto-promote the behavior.
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				behaviorId: beh.behavior.id,
				requestedPhase: "green",
				citedArtifactId: artifactId,
			})) as { accepted: boolean };
			expect(r.accepted).toBe(true);

			// After the accepted transition the behavior must be in_progress.
			const after = (await caller.tdd_behavior({ action: "get", id: beh.behavior.id })) as {
				found: true;
				behavior: { status: string };
			};
			expect(after.behavior.status).toBe("in_progress");
		});

		it("auto-resolves citedArtifactId for spike→red when neither citedArtifactId nor citedArtifactKind is supplied (no artifact required)", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-spike-red-noart", "g");
			const caller = createTestCaller();
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				requestedPhase: "red",
			})) as { accepted: boolean; phase?: string };
			expect(r.accepted).toBe(true);
			expect(r.phase).toBe("red");
		});

		it("auto-resolves citedArtifactId from citedArtifactKind by picking the most recent matching artifact", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-autoresolve-kind", "g");
			const { newest } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const phase = yield* store.writeTddPhase({
						tddTaskId: tddId,
						phase: "spike",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* store.writeTddArtifact({
						phaseId: phase.id,
						artifactKind: "test_failed_run",
						recordedAt: "2026-04-30T00:00:01Z",
					});
					const newest = yield* store.writeTddArtifact({
						phaseId: phase.id,
						artifactKind: "test_failed_run",
						recordedAt: "2026-04-30T00:00:02Z",
					});
					return { newest };
				}),
			);
			const caller = createTestCaller();
			// Request spike→red (no required artifact) but pass an explicit
			// citedArtifactKind to exercise the explicit-kind branch. The
			// transition itself still accepts; the response should echo the
			// auto-picked id and source label.
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				requestedPhase: "red",
				citedArtifactKind: "test_failed_run",
			})) as { accepted: boolean; citedArtifactId?: number; citedArtifactSource?: string };
			expect(r.accepted).toBe(true);
			expect(r.citedArtifactId).toBe(newest);
			expect(r.citedArtifactSource).toBe("explicit-kind");
		});

		it("denies with missing_artifact_evidence when no artifact of the auto-derived kind exists", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-noevidence", "g");
			// Force the session into red phase so red→green will be the
			// requested transition (which requires test_failed_run).
			await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					yield* store.writeTddPhase({
						tddTaskId: tddId,
						phase: "red",
						startedAt: new Date().toISOString(),
					});
				}),
			);
			const caller = createTestCaller();
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				requestedPhase: "green",
			})) as { accepted: boolean; denialReason?: string; remediation?: { humanHint: string } };
			expect(r.accepted).toBe(false);
			expect(r.denialReason).toBe("missing_artifact_evidence");
			expect(r.remediation?.humanHint).toMatch(/test_failed_run/);
		});

		it("auto-resolves the failing run for the REQUESTED behavior on red→green, not the newest across behaviors (issue #115)", async () => {
			// Given: two behaviors, each with a test_failed_run. Behavior 2's run is the NEWEST by
			// recorded_at, but behavior 1's is the one we're greening. Before issue #115, auto-resolution
			// ignored behaviorId and grabbed the newest matching artifact task-wide — behavior 2's — which
			// the validator then rejected at rule 2 (evidence_not_for_behavior), even though behavior 1's
			// valid failing run existed. Auto-resolution must scope the lookup to the requested behavior.
			const { tddId, goalId, sessionId } = await seedTddSessionForTransition("cc-tdd-trans-autoresolve-beh", "g");
			const caller = createTestCaller();
			const b1 = (await caller.tdd_behavior({ action: "create", goalId, behavior: "beh-1" })) as {
				ok: true;
				behavior: { id: number };
			};
			const b2 = (await caller.tdd_behavior({ action: "create", goalId, behavior: "beh-2" })) as {
				ok: true;
				behavior: { id: number };
			};

			const b1PhaseStart = "2026-05-01T01:00:00.000Z";
			const { b1Artifact } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;

					// Behavior 2's phase + NEWEST failing run (older phase start, newest recorded_at).
					const b2Phase = yield* store.writeTddPhase({
						tddTaskId: tddId,
						behaviorId: b2.behavior.id,
						phase: "red",
						startedAt: "2026-05-01T00:00:00.000Z",
					});
					yield* store.writeTddArtifact({
						phaseId: b2Phase.id,
						artifactKind: "test_failed_run",
						recordedAt: "2026-05-01T02:00:00.000Z",
					});

					// Behavior 1's phase (opened last → current open phase) + a fully valid failing run,
					// recorded BEFORE behavior 2's so it is not the newest.
					const turnOccurredAt = "2026-05-01T01:00:00.100Z";
					const turnId = yield* store.writeTurn({
						sessionId,
						type: "file_edit",
						payload: JSON.stringify({ type: "file_edit", file_path: "src/b1.test.ts", edit_kind: "write" }),
						occurredAt: turnOccurredAt,
					});
					yield* store.writeSettings("hash-b1", { vitestVersion: "4.1.0" }, {});
					const runId = yield* store.writeRun({
						invocationId: "inv-b1-001",
						project: "default",
						settingsHash: "hash-b1",
						timestamp: turnOccurredAt,
						commitSha: null,
						branch: null,
						reason: "failed",
						duration: 500,
						total: 1,
						passed: 0,
						failed: 1,
						skipped: 0,
						scoped: false,
					});
					const fileId = yield* store.ensureFile("src/b1.test.ts");
					const [moduleId] = yield* store.writeModules(runId, [
						{ fileId, relativeModuleId: "src/b1.test.ts", state: "failed", duration: 200 },
					]);
					const [testCaseId] = yield* store.writeTestCases(moduleId, [
						{ name: "b1 behavior", fullName: "b1 > behavior", state: "failed", duration: 10, createdTurnId: turnId },
					]);
					const b1Phase = yield* store.writeTddPhase({
						tddTaskId: tddId,
						behaviorId: b1.behavior.id,
						phase: "red",
						startedAt: b1PhaseStart,
					});
					const b1Artifact = yield* store.writeTddArtifact({
						phaseId: b1Phase.id,
						artifactKind: "test_failed_run",
						testCaseId,
						testRunId: runId,
						testFirstFailureRunId: runId,
						recordedAt: "2026-05-01T01:00:01.000Z",
					});
					return { b1Artifact };
				}),
			);

			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				behaviorId: b1.behavior.id,
				requestedPhase: "green",
			})) as { accepted: boolean; citedArtifactId?: number; denialReason?: string };

			// Then: accepted, and the auto-resolved artifact is behavior 1's — not behavior 2's newer run.
			expect(r.accepted).toBe(true);
			expect(r.citedArtifactId).toBe(b1Artifact);
		});

		it("auto-resolves the batch failing run (cross-behavior) on red.triangulate→green without behavior-scoping (issue #115)", async () => {
			// Given: a triangulation batch. Behavior 1 produced the batch's real failing run; behavior 2
			// is a later member whose own test passed the moment the shared implementation landed, so it
			// has NO failing run of its own. Requesting red.triangulate→green for behavior 2 must auto-resolve
			// behavior 1's failing run — the lookup must NOT be scoped to behavior 2 (which owns nothing),
			// mirroring the validator's decision to skip behavior-match for triangulation.
			const { tddId, goalId, sessionId } = await seedTddSessionForTransition("cc-tdd-trans-triangulate", "g");
			const caller = createTestCaller();
			const b1 = (await caller.tdd_behavior({ action: "create", goalId, behavior: "tri-1" })) as {
				ok: true;
				behavior: { id: number };
			};
			const b2 = (await caller.tdd_behavior({ action: "create", goalId, behavior: "tri-2" })) as {
				ok: true;
				behavior: { id: number };
			};

			const { b1Artifact } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;

					// Behavior 1's red.triangulate phase + the batch's real failing run.
					const turnOccurredAt = "2026-05-02T00:00:00.100Z";
					const turnId = yield* store.writeTurn({
						sessionId,
						type: "file_edit",
						payload: JSON.stringify({ type: "file_edit", file_path: "src/tri.test.ts", edit_kind: "write" }),
						occurredAt: turnOccurredAt,
					});
					yield* store.writeSettings("hash-tri", { vitestVersion: "4.1.0" }, {});
					const runId = yield* store.writeRun({
						invocationId: "inv-tri-001",
						project: "default",
						settingsHash: "hash-tri",
						timestamp: turnOccurredAt,
						commitSha: null,
						branch: null,
						reason: "failed",
						duration: 500,
						total: 1,
						passed: 0,
						failed: 1,
						skipped: 0,
						scoped: false,
					});
					const fileId = yield* store.ensureFile("src/tri.test.ts");
					const [moduleId] = yield* store.writeModules(runId, [
						{ fileId, relativeModuleId: "src/tri.test.ts", state: "failed", duration: 200 },
					]);
					const [testCaseId] = yield* store.writeTestCases(moduleId, [
						{ name: "tri-1 behavior", fullName: "tri > 1", state: "failed", duration: 10, createdTurnId: turnId },
					]);
					const b1Phase = yield* store.writeTddPhase({
						tddTaskId: tddId,
						behaviorId: b1.behavior.id,
						phase: "red.triangulate",
						startedAt: "2026-05-02T00:00:00.000Z",
					});
					const b1Artifact = yield* store.writeTddArtifact({
						phaseId: b1Phase.id,
						artifactKind: "test_failed_run",
						testCaseId,
						testRunId: runId,
						testFirstFailureRunId: runId,
						recordedAt: "2026-05-02T00:00:01.000Z",
					});

					// Behavior 2's red.triangulate phase (opened last → current) with NO failing run of its own.
					yield* store.writeTddPhase({
						tddTaskId: tddId,
						behaviorId: b2.behavior.id,
						phase: "red.triangulate",
						startedAt: "2026-05-02T01:00:00.000Z",
					});
					return { b1Artifact };
				}),
			);

			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				behaviorId: b2.behavior.id,
				requestedPhase: "green",
			})) as { accepted: boolean; citedArtifactId?: number; denialReason?: string };

			// Then: accepted, citing behavior 1's batch failing run — resolution was not scoped to behavior 2.
			expect(r.accepted).toBe(true);
			expect(r.citedArtifactId).toBe(b1Artifact);
		});

		it("echoes citedArtifactSource='explicit-id' when citedArtifactId was supplied", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-explicit-id", "g");
			const { artifactId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const phase = yield* store.writeTddPhase({
						tddTaskId: tddId,
						phase: "spike",
						startedAt: new Date().toISOString(),
					});
					const artifactId = yield* store.writeTddArtifact({
						phaseId: phase.id,
						artifactKind: "test_written",
						recordedAt: new Date().toISOString(),
					});
					return { artifactId };
				}),
			);
			const caller = createTestCaller();
			const r = (await caller.tdd_phase_transition_request({
				tddTaskId: tddId,
				goalId,
				requestedPhase: "red",
				citedArtifactId: artifactId,
			})) as { accepted: boolean; citedArtifactId?: number; citedArtifactSource?: string };
			expect(r.accepted).toBe(true);
			expect(r.citedArtifactId).toBe(artifactId);
			expect(r.citedArtifactSource).toBe("explicit-id");
		});
	});

	describe("tdd_goal_* and tdd_behavior_* tools", () => {
		const seedTddSession = async (chatId: string, goal: string = "obj") => {
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						chatId: chatId,
						project: "default",
						cwd: process.cwd(),
						agentKind: "main",
						startedAt: new Date().toISOString(),
					});
				}),
			);
			const caller = createTestCaller();
			const tdd = await caller.tdd_task({ action: "start", sessionId, goal });
			return (tdd as { tddTaskId: number }).tddTaskId;
		};

		it("creates a goal and returns it with ordinal 0", async () => {
			const tddId = await seedTddSession("cc-mcp-goal-create");
			const caller = createTestCaller();
			const r = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "Handle bounds" })) as {
				ok: true;
				goal: { id: number; ordinal: number; goal: string; status: string };
			};
			expect(r.ok).toBe(true);
			expect(r.goal.ordinal).toBe(0);
			expect(r.goal.goal).toBe("Handle bounds");
			expect(r.goal.status).toBe("pending");
		});

		it("returns idempotent replay on duplicate tdd_goal_create", async () => {
			const tddId = await seedTddSession("cc-mcp-goal-idem");
			const caller = createTestCaller();
			const a = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			const b = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
				_idempotentReplay?: boolean;
			};
			expect(a.goal.id).toBe(b.goal.id);
			expect(b._idempotentReplay).toBe(true);
		});

		it("returns error envelope for tdd_goal_create against unknown session", async () => {
			const caller = createTestCaller();
			const r = (await caller.tdd_goal({ action: "create", tddTaskId: 99999, goal: "G" })) as {
				ok: false;
				error: { _tag: string; remediation: { humanHint: string } };
			};
			expect(r.ok).toBe(false);
			expect(r.error._tag).toBe("TddTaskNotFoundError");
			expect(r.error.remediation.humanHint).toContain("tdd_task");
		});

		it("supports tdd_goal_get, tdd_goal_update, tdd_goal_list lifecycle", async () => {
			const tddId = await seedTddSession("cc-mcp-goal-lifecycle");
			const caller = createTestCaller();
			const created = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			const fetched = (await caller.tdd_goal({ action: "get", id: created.goal.id })) as {
				found: true;
				goal: { goal: string; behaviors: ReadonlyArray<unknown> };
			};
			expect(fetched.found).toBe(true);
			expect(fetched.goal.goal).toBe("G");
			expect(fetched.goal.behaviors).toEqual([]);
			const updated = (await caller.tdd_goal({ action: "update", id: created.goal.id, status: "in_progress" })) as {
				ok: true;
				goal: { status: string };
			};
			expect(updated.goal.status).toBe("in_progress");
			const list = (await caller.tdd_goal({ action: "list", tddTaskId: tddId })) as {
				ok: true;
				goals: ReadonlyArray<{ id: number; status: string }>;
			};
			expect(list.goals).toHaveLength(1);
			expect(list.goals[0]?.status).toBe("in_progress");
		});

		it("rejects done → pending transition with IllegalStatusTransitionError envelope", async () => {
			const tddId = await seedTddSession("cc-mcp-goal-illegal");
			const caller = createTestCaller();
			const created = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			await caller.tdd_goal({ action: "update", id: created.goal.id, status: "in_progress" });
			await caller.tdd_goal({ action: "update", id: created.goal.id, status: "done" });
			const r = (await caller.tdd_goal({ action: "update", id: created.goal.id, status: "pending" })) as {
				ok: false;
				error: { _tag: string };
			};
			expect(r.ok).toBe(false);
			expect(r.error._tag).toBe("IllegalStatusTransitionError");
		});

		it("creates a behavior with dependencies and surfaces full BehaviorDetail via tdd_behavior_get", async () => {
			const tddId = await seedTddSession("cc-mcp-beh-deps");
			const caller = createTestCaller();
			const goal = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			const dep = (await caller.tdd_behavior({ action: "create", goalId: goal.goal.id, behavior: "dep" })) as {
				ok: true;
				behavior: { id: number };
			};
			const target = (await caller.tdd_behavior({
				action: "create",
				goalId: goal.goal.id,
				behavior: "target",
				dependsOnBehaviorIds: [dep.behavior.id],
			})) as { ok: true; behavior: { id: number } };
			const fetched = (await caller.tdd_behavior({ action: "get", id: target.behavior.id })) as {
				found: true;
				behavior: {
					behavior: string;
					parentGoal: { goal: string };
					dependencies: ReadonlyArray<{ behavior: string }>;
				};
			};
			expect(fetched.found).toBe(true);
			expect(fetched.behavior.parentGoal.goal).toBe("G");
			expect(fetched.behavior.dependencies).toHaveLength(1);
			expect(fetched.behavior.dependencies[0]?.behavior).toBe("dep");
		});

		it("tdd_behavior_list scope='goal' returns the goal's behaviors", async () => {
			const tddId = await seedTddSession("cc-mcp-beh-list-goal");
			const caller = createTestCaller();
			const goal = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			await caller.tdd_behavior({ action: "create", goalId: goal.goal.id, behavior: "x" });
			await caller.tdd_behavior({ action: "create", goalId: goal.goal.id, behavior: "y" });
			const r = (await caller.tdd_behavior({ action: "list_by_goal", goalId: goal.goal.id })) as {
				ok: true;
				behaviors: ReadonlyArray<{ behavior: string }>;
			};
			expect(r.ok).toBe(true);
			expect(r.behaviors.map((b) => b.behavior)).toEqual(["x", "y"]);
		});

		it("tdd_behavior_list scope='session' returns behaviors across goals", async () => {
			const tddId = await seedTddSession("cc-mcp-beh-list-session");
			const caller = createTestCaller();
			const g1 = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "g1" })) as {
				ok: true;
				goal: { id: number };
			};
			const g2 = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "g2" })) as {
				ok: true;
				goal: { id: number };
			};
			await caller.tdd_behavior({ action: "create", goalId: g1.goal.id, behavior: "a" });
			await caller.tdd_behavior({ action: "create", goalId: g2.goal.id, behavior: "b" });
			const r = (await caller.tdd_behavior({ action: "list_by_tdd_task", tddTaskId: tddId })) as {
				ok: true;
				behaviors: ReadonlyArray<{ behavior: string }>;
			};
			expect(r.behaviors.map((b) => b.behavior).sort()).toEqual(["a", "b"]);
		});

		it("tdd_behavior_delete cascades dependency rows", async () => {
			const tddId = await seedTddSession("cc-mcp-beh-delete");
			const caller = createTestCaller();
			const goal = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			const dep = (await caller.tdd_behavior({ action: "create", goalId: goal.goal.id, behavior: "dep" })) as {
				ok: true;
				behavior: { id: number };
			};
			const target = (await caller.tdd_behavior({
				action: "create",
				goalId: goal.goal.id,
				behavior: "target",
				dependsOnBehaviorIds: [dep.behavior.id],
			})) as { ok: true; behavior: { id: number } };
			const del = (await caller.tdd_behavior({ action: "delete", id: target.behavior.id })) as { ok: true };
			expect(del.ok).toBe(true);
			const fetched = (await caller.tdd_behavior({ action: "get", id: target.behavior.id })) as { found: false };
			expect(fetched.found).toBe(false);
		});
	});
});
