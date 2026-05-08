import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { DataStore, OutputPipelineLive, ProjectDiscoveryTest } from "vitest-agent-sdk";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef } from "../src/context.js";
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
	});
}

async function seedTestData() {
	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;

			// Write settings
			yield* store.writeSettings(
				"abc123",
				{ vitest_version: "3.2.0", pool: "forks", coverage_provider: "v8" },
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
		expect(result).toContain("vitest-agent MCP Tools");
		expect(result).toContain("test_status");
		expect(result).toContain("run_tests");
		expect(result).toContain("note_create");
		expect(result).toContain("Parameter Key");
	});

	it("test_status returns no data message on empty DB", async () => {
		const caller = createTestCaller();
		const result = await caller.test_status({});
		expect(result).toContain("No test data");
	});

	it("cache_health returns diagnostic on empty DB", async () => {
		const caller = createTestCaller();
		const result = await caller.cache_health();
		expect(typeof result).toBe("string");
		expect(result).toContain("Cache Health");
	});

	it("test_overview returns no data message on empty DB", async () => {
		const caller = createTestCaller();
		const result = await caller.test_overview({});
		expect(result).toContain("No test data");
	});

	it("configure returns settings when no hash provided", async () => {
		await seedTestData();
		const caller = createTestCaller();
		const result = await caller.configure({});
		expect(typeof result).toBe("string");
		expect(result).toContain("Settings");
		expect(result).toContain("abc123");
	});

	it("note CRUD lifecycle", async () => {
		const caller = createTestCaller();

		// Create
		const { id } = await caller.note_create({
			title: "Test Note",
			content: "Some content",
			scope: "global",
		});
		expect(id).toBeGreaterThan(0);

		// Read
		const note = await caller.note_get({ id });
		expect(note.found).toBe(true);
		if (note.found) expect(note.note.title).toBe("Test Note");

		// Update
		await caller.note_update({ id, title: "Updated" });
		const updated = await caller.note_get({ id });
		expect(updated.found).toBe(true);
		if (updated.found) expect(updated.note.title).toBe("Updated");

		// Delete
		await caller.note_delete({ id });
		const deleted = await caller.note_get({ id });
		expect(deleted.found).toBe(false);
	});

	it("note_list returns no notes message for empty state", async () => {
		// Use a scope filter that won't match any notes
		const caller = createTestCaller();
		const result = await caller.note_list({ scope: "test", testFullName: "nonexistent" });
		expect(typeof result).toBe("string");
		expect(result).toContain("No notes found");
	});

	it("note_list returns markdown table when notes exist", async () => {
		const caller = createTestCaller();
		await caller.note_create({
			title: "Table Note",
			content: "Content for table test",
			scope: "global",
		});
		const result = await caller.note_list({});
		expect(typeof result).toBe("string");
		expect(result).toContain("## Notes");
		expect(result).toContain("| ID |");
		expect(result).toContain("Table Note");
	});

	it("note_search returns no notes for empty results", async () => {
		const caller = createTestCaller();
		const result = await caller.note_search({ query: "nonexistentkeyword999" });
		expect(typeof result).toBe("string");
		expect(result).toContain("No notes found");
	});

	it("note_search returns markdown table for matching content", async () => {
		const caller = createTestCaller();

		await caller.note_create({
			title: "Searchable Note",
			content: "This contains unique keyword xylophone",
			scope: "global",
		});

		const result = await caller.note_search({ query: "xylophone" });
		expect(typeof result).toBe("string");
		expect(result).toContain('Notes matching "xylophone"');
		expect(result).toContain("| ID |");
	});

	it("test_for_file returns no tests message for unknown file", async () => {
		const caller = createTestCaller();
		const result = await caller.test_for_file({ filePath: "nonexistent.ts" });
		expect(result).toContain("No test modules found");
	});

	it("test_coverage returns coverage data after seeding", async () => {
		const caller = createTestCaller();
		const result = await caller.test_coverage({ project: "default" });
		expect(typeof result).toBe("string");
		expect(result).toContain("Coverage Report");
		expect(result).toContain("statements");
	});

	it("run_tests returns text content", { timeout: 30_000 }, async () => {
		// Anchor at an empty tempdir so the nested vitest invocation does not
		// pick up this monorepo's vitest.config.ts (which would re-load the
		// AgentPlugin and contend with the outer reporter on the same DB).
		const isolated = mkdtempSync(join(tmpdir(), "vitest-agent-run-tests-"));
		try {
			const caller = createTestCaller(isolated);
			const result = await caller.run_tests({ files: ["nonexistent.test.ts"], timeout: 5 });
			expect(typeof result).toBe("string");
		} finally {
			rmSync(isolated, { recursive: true, force: true });
		}
	});

	it("project_list returns markdown with Projects heading", async () => {
		const caller = createTestCaller();
		const result = await caller.project_list({});
		expect(typeof result).toBe("string");
		expect(result).toContain("Projects");
	});

	it("test_list returns string", async () => {
		const caller = createTestCaller();
		const result = await caller.test_list({ project: "default" });
		expect(typeof result).toBe("string");
	});

	it("module_list returns string", async () => {
		const caller = createTestCaller();
		const result = await caller.module_list({ project: "default" });
		expect(typeof result).toBe("string");
	});

	it("suite_list returns string", async () => {
		const caller = createTestCaller();
		const result = await caller.suite_list({ project: "default" });
		expect(typeof result).toBe("string");
	});

	it("settings_list returns markdown with Settings and Hash", async () => {
		const caller = createTestCaller();
		const result = await caller.settings_list({});
		expect(typeof result).toBe("string");
		expect(result).toContain("Settings");
		expect(result).toContain("Hash");
	});

	it("test_get returns test details for known test", async () => {
		const caller = createTestCaller();
		const result = await caller.test_get({ fullName: "utils > adds numbers", project: "default" });
		expect(typeof result).toBe("string");
		expect(result).toContain("utils > adds numbers");
		expect(result).toContain("## Details");
		expect(result).toContain("passed");
		expect(result).toContain("src/utils.test.ts");
	});

	it("test_get returns not found for unknown test", async () => {
		const caller = createTestCaller();
		const result = await caller.test_get({ fullName: "nonexistent > test", project: "default" });
		expect(result).toContain("Test not found");
		expect(result).toContain("test_list");
	});

	it("file_coverage returns coverage data for tracked file", async () => {
		const caller = createTestCaller();
		const result = await caller.file_coverage({ filePath: "src/utils.ts", project: "default" });
		expect(typeof result).toBe("string");
		expect(result).toContain("src/utils.ts");
		// File is in lowCoverage (branches at 70% below typical threshold)
		// or shows project totals if not in lowCoverage list
		expect(result).toMatch(/Metrics|Coverage Totals/);
	});

	it("file_coverage returns fallback for unknown file", async () => {
		const caller = createTestCaller();
		const result = await caller.file_coverage({ filePath: "nonexistent.ts", project: "default" });
		expect(typeof result).toBe("string");
		expect(result).toContain("nonexistent.ts");
		expect(result).toContain("not in the low-coverage list");
	});

	describe("hypothesis_record and hypothesis_validate", () => {
		it("hypothesis_record creates a hypothesis and returns { id }", async () => {
			// Seed a session so the FK resolves
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						cc_session_id: "cc-hyp-record-test",
						project: "default",
						cwd: process.cwd(),
						agent_kind: "main",
						started_at: new Date().toISOString(),
					});
				}),
			);

			const caller = createTestCaller();
			const first = await caller.hypothesis_record({
				sessionId,
				content: "The failure is caused by a missing null guard in the parser.",
			});

			expect(first).toHaveProperty("id");
			expect((first as { id: number }).id).toBeGreaterThan(0);
			// Fresh insert must NOT carry the replay marker.
			expect((first as { _idempotentReplay?: true })._idempotentReplay).toBeUndefined();

			// Second call with the same key replays the cached response with
			// the _idempotentReplay marker attached.
			const replay = await caller.hypothesis_record({
				sessionId,
				content: "The failure is caused by a missing null guard in the parser.",
			});
			expect((replay as { id: number }).id).toBe((first as { id: number }).id);
			expect((replay as { _idempotentReplay?: true })._idempotentReplay).toBe(true);
		});

		it("hypothesis_validate updates the validation outcome to confirmed", async () => {
			// Seed session + hypothesis
			const { hypothesisId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sessionId = yield* store.writeSession({
						cc_session_id: "cc-hyp-validate-test",
						project: "default",
						cwd: process.cwd(),
						agent_kind: "main",
						started_at: new Date().toISOString(),
					});
					const hypothesisId = yield* store.writeHypothesis({
						sessionId,
						content: "Race condition in the event loop.",
					});
					return { hypothesisId };
				}),
			);

			const caller = createTestCaller();
			const result = await caller.hypothesis_validate({
				id: hypothesisId,
				outcome: "confirmed",
				validatedAt: new Date().toISOString(),
			});

			expect(result).toEqual({});
		});

		it("hypothesis_validate returns error for unknown hypothesis id", async () => {
			const caller = createTestCaller();
			await expect(
				caller.hypothesis_validate({
					id: 999999,
					outcome: "refuted",
					validatedAt: new Date().toISOString(),
				}),
			).rejects.toThrow();
		});
	});

	describe("triage_brief tool", () => {
		it("returns 'no orientation signal' on empty DB", async () => {
			const caller = createTestCaller();
			const result = await caller.triage_brief({});
			expect(typeof result).toBe("string");
			expect(result).toMatch(/No orientation signal|orientation triage|Recent Test Runs/i);
		});

		it("includes content when test runs are seeded", async () => {
			const caller = createTestCaller();
			await seedTestData();
			const result = await caller.triage_brief({});
			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
		});
	});

	describe("wrapup_prompt tool", () => {
		it("returns 'Nothing to wrap up' for an unknown session", async () => {
			const caller = createTestCaller();
			const result = await caller.wrapup_prompt({});
			expect(typeof result).toBe("string");
			expect(result).toMatch(/Nothing to wrap up|no recent activity/i);
		});

		it("emits a failure-prompt nudge for the user_prompt_nudge variant", async () => {
			const caller = createTestCaller();
			const result = await caller.wrapup_prompt({
				kind: "user_prompt_nudge",
				userPromptHint: "fix the broken test in foo.test.ts",
			});
			expect(result).toContain("test_history");
			expect(result).toContain("failure_signature_get");
		});
	});

	describe("tdd_session_start tool", () => {
		it("inserts on first call and replays on second", async () => {
			// Seed a session so the FK resolves.
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						cc_session_id: "cc-tdd-start-test",
						project: "default",
						cwd: process.cwd(),
						agent_kind: "main",
						started_at: new Date().toISOString(),
					});
				}),
			);

			const caller = createTestCaller();
			const r1 = await caller.tdd_session_start({ sessionId, goal: "add login" });
			const r2 = await caller.tdd_session_start({ sessionId, goal: "add login" });
			expect((r1 as { id: number }).id).toBe((r2 as { id: number }).id);
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
						cc_session_id: "cc-tdd-end-test",
						project: "default",
						cwd: process.cwd(),
						agent_kind: "main",
						started_at: new Date().toISOString(),
					});
				}),
			);

			const caller = createTestCaller();
			const created = await caller.tdd_session_start({ sessionId, goal: "ending-test" });
			const r1 = await caller.tdd_session_end({
				tddSessionId: (created as { id: number }).id,
				outcome: "succeeded",
			});
			const r2 = await caller.tdd_session_end({
				tddSessionId: (created as { id: number }).id,
				outcome: "succeeded",
			});
			expect((r1 as { outcome: string }).outcome).toBe("succeeded");
			expect((r2 as { _idempotentReplay?: boolean })._idempotentReplay).toBe(true);
		});
	});

	describe("commit_changes tool", () => {
		it("returns 'No commits recorded' on empty DB", async () => {
			const caller = createTestCaller();
			const r = await caller.commit_changes({});
			expect(r).toMatch(/No commits recorded/);
		});
	});

	describe("tdd_session_resume tool", () => {
		it("renders a markdown digest for an existing TDD session", async () => {
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						cc_session_id: "cc-tdd-resume-test",
						project: "default",
						cwd: process.cwd(),
						agent_kind: "main",
						started_at: new Date().toISOString(),
					});
				}),
			);
			const caller = createTestCaller();
			const tdd = await caller.tdd_session_start({ sessionId, goal: "resume-test" });
			const tddId = (tdd as { id: number }).id;
			const out = await caller.tdd_session_resume({ id: tddId });
			expect(out).toContain(`TDD session #${tddId}`);
			expect(out).toContain("resume-test");
		});

		it("returns 'No TDD session' for unknown id", async () => {
			const caller = createTestCaller();
			const out = await caller.tdd_session_resume({ id: 99999 });
			expect(out).toMatch(/No TDD session/);
		});
	});

	describe("tdd_phase_transition_request tool", () => {
		async function seedTddSessionForTransition(
			ccSessionId: string,
			goalText: string,
		): Promise<{ tddId: number; goalId: number; sessionId: number }> {
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						cc_session_id: ccSessionId,
						project: "default",
						cwd: process.cwd(),
						agent_kind: "main",
						started_at: new Date().toISOString(),
					});
				}),
			);
			const caller = createTestCaller();
			const tdd = await caller.tdd_session_start({ sessionId, goal: goalText });
			const tddId = (tdd as { id: number }).id;
			const goalRes = (await caller.tdd_goal_create({ sessionId: tddId, goal: goalText })) as {
				ok: true;
				goal: { id: number };
			};
			await caller.tdd_goal_update({ id: goalRes.goal.id, status: "in_progress" });
			return { tddId, goalId: goalRes.goal.id, sessionId };
		}

		it("rejects with missing_artifact_evidence when cited artifact does not exist", async () => {
			const { tddId, goalId } = await seedTddSessionForTransition("cc-tdd-trans-missing", "g");
			const caller = createTestCaller();
			const r = (await caller.tdd_phase_transition_request({
				tddSessionId: tddId,
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
						tddSessionId: tddId,
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
				tddSessionId: tddId,
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
				tddSessionId: tddId,
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
			await caller.tdd_goal_update({ id: goalId, status: "done" });
			const r = (await caller.tdd_phase_transition_request({
				tddSessionId: tddId,
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
				tddSessionId: tddId,
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
			const otherGoal = (await caller.tdd_goal_create({ sessionId: tddId, goal: "other" })) as {
				ok: true;
				goal: { id: number };
			};
			const otherBeh = (await caller.tdd_behavior_create({ goalId: otherGoal.goal.id, behavior: "x" })) as {
				ok: true;
				behavior: { id: number };
			};
			const r = (await caller.tdd_phase_transition_request({
				tddSessionId: tddId,
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
			const beh = (await caller.tdd_behavior_create({ goalId, behavior: "b1" })) as {
				ok: true;
				behavior: { id: number; status: string };
			};
			expect(beh.behavior.status).toBe("pending");

			const { artifactId } = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const phase = yield* store.writeTddPhase({
						tddSessionId: tddId,
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
				tddSessionId: tddId,
				goalId,
				behaviorId: beh.behavior.id,
				requestedPhase: "red",
				citedArtifactId: artifactId,
			})) as { accepted: boolean };
			expect(r.accepted).toBe(true);

			const updated = (await caller.tdd_behavior_get({ id: beh.behavior.id })) as {
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
			const beh = (await caller.tdd_behavior_create({ goalId, behavior: "green-b1" })) as {
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
						session_id: sessionId,
						type: "file_edit",
						payload: JSON.stringify({
							type: "file_edit",
							file_path: "src/example.test.ts",
							edit_kind: "write",
						}),
						occurred_at: turnOccurredAt,
					});

					// Write a test run.
					yield* store.writeSettings("hash-green-test", { vitest_version: "4.1.0" }, {});
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
							created_turn_id: turnId,
						},
					]);

					// Open a red phase with the behavior_id — the validator reads
					// tdd_phases.behavior_id to enforce D2 binding rule 2.
					const redPhase = yield* store.writeTddPhase({
						tddSessionId: tddId,
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
			const before = (await caller.tdd_behavior_get({ id: beh.behavior.id })) as {
				found: true;
				behavior: { status: string };
			};
			expect(before.behavior.status).toBe("pending");

			// Request red→green — this should be accepted and auto-promote the behavior.
			const r = (await caller.tdd_phase_transition_request({
				tddSessionId: tddId,
				goalId,
				behaviorId: beh.behavior.id,
				requestedPhase: "green",
				citedArtifactId: artifactId,
			})) as { accepted: boolean };
			expect(r.accepted).toBe(true);

			// After the accepted transition the behavior must be in_progress.
			const after = (await caller.tdd_behavior_get({ id: beh.behavior.id })) as {
				found: true;
				behavior: { status: string };
			};
			expect(after.behavior.status).toBe("in_progress");
		});
	});

	describe("tdd_goal_* and tdd_behavior_* tools", () => {
		const seedTddSession = async (ccSessionId: string, goal: string = "obj") => {
			const sessionId = await testRuntime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeSession({
						cc_session_id: ccSessionId,
						project: "default",
						cwd: process.cwd(),
						agent_kind: "main",
						started_at: new Date().toISOString(),
					});
				}),
			);
			const caller = createTestCaller();
			const tdd = await caller.tdd_session_start({ sessionId, goal });
			return (tdd as { id: number }).id;
		};

		it("creates a goal and returns it with ordinal 0", async () => {
			const tddId = await seedTddSession("cc-mcp-goal-create");
			const caller = createTestCaller();
			const r = (await caller.tdd_goal_create({ sessionId: tddId, goal: "Handle bounds" })) as {
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
			const a = (await caller.tdd_goal_create({ sessionId: tddId, goal: "G" })) as { ok: true; goal: { id: number } };
			const b = (await caller.tdd_goal_create({ sessionId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
				_idempotentReplay?: boolean;
			};
			expect(a.goal.id).toBe(b.goal.id);
			expect(b._idempotentReplay).toBe(true);
		});

		it("returns error envelope for tdd_goal_create against unknown session", async () => {
			const caller = createTestCaller();
			const r = (await caller.tdd_goal_create({ sessionId: 99999, goal: "G" })) as {
				ok: false;
				error: { _tag: string; remediation: { humanHint: string } };
			};
			expect(r.ok).toBe(false);
			expect(r.error._tag).toBe("TddSessionNotFoundError");
			expect(r.error.remediation.humanHint).toContain("tdd_session_start");
		});

		it("supports tdd_goal_get, tdd_goal_update, tdd_goal_list lifecycle", async () => {
			const tddId = await seedTddSession("cc-mcp-goal-lifecycle");
			const caller = createTestCaller();
			const created = (await caller.tdd_goal_create({ sessionId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			const fetched = (await caller.tdd_goal_get({ id: created.goal.id })) as {
				found: true;
				goal: { goal: string; behaviors: ReadonlyArray<unknown> };
			};
			expect(fetched.found).toBe(true);
			expect(fetched.goal.goal).toBe("G");
			expect(fetched.goal.behaviors).toEqual([]);
			const updated = (await caller.tdd_goal_update({ id: created.goal.id, status: "in_progress" })) as {
				ok: true;
				goal: { status: string };
			};
			expect(updated.goal.status).toBe("in_progress");
			const list = (await caller.tdd_goal_list({ sessionId: tddId })) as {
				ok: true;
				goals: ReadonlyArray<{ id: number; status: string }>;
			};
			expect(list.goals).toHaveLength(1);
			expect(list.goals[0]?.status).toBe("in_progress");
		});

		it("rejects done → pending transition with IllegalStatusTransitionError envelope", async () => {
			const tddId = await seedTddSession("cc-mcp-goal-illegal");
			const caller = createTestCaller();
			const created = (await caller.tdd_goal_create({ sessionId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			await caller.tdd_goal_update({ id: created.goal.id, status: "in_progress" });
			await caller.tdd_goal_update({ id: created.goal.id, status: "done" });
			const r = (await caller.tdd_goal_update({ id: created.goal.id, status: "pending" })) as {
				ok: false;
				error: { _tag: string };
			};
			expect(r.ok).toBe(false);
			expect(r.error._tag).toBe("IllegalStatusTransitionError");
		});

		it("creates a behavior with dependencies and surfaces full BehaviorDetail via tdd_behavior_get", async () => {
			const tddId = await seedTddSession("cc-mcp-beh-deps");
			const caller = createTestCaller();
			const goal = (await caller.tdd_goal_create({ sessionId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			const dep = (await caller.tdd_behavior_create({ goalId: goal.goal.id, behavior: "dep" })) as {
				ok: true;
				behavior: { id: number };
			};
			const target = (await caller.tdd_behavior_create({
				goalId: goal.goal.id,
				behavior: "target",
				dependsOnBehaviorIds: [dep.behavior.id],
			})) as { ok: true; behavior: { id: number } };
			const fetched = (await caller.tdd_behavior_get({ id: target.behavior.id })) as {
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
			const goal = (await caller.tdd_goal_create({ sessionId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			await caller.tdd_behavior_create({ goalId: goal.goal.id, behavior: "x" });
			await caller.tdd_behavior_create({ goalId: goal.goal.id, behavior: "y" });
			const r = (await caller.tdd_behavior_list({ scope: "goal", goalId: goal.goal.id })) as {
				ok: true;
				behaviors: ReadonlyArray<{ behavior: string }>;
			};
			expect(r.ok).toBe(true);
			expect(r.behaviors.map((b) => b.behavior)).toEqual(["x", "y"]);
		});

		it("tdd_behavior_list scope='session' returns behaviors across goals", async () => {
			const tddId = await seedTddSession("cc-mcp-beh-list-session");
			const caller = createTestCaller();
			const g1 = (await caller.tdd_goal_create({ sessionId: tddId, goal: "g1" })) as {
				ok: true;
				goal: { id: number };
			};
			const g2 = (await caller.tdd_goal_create({ sessionId: tddId, goal: "g2" })) as {
				ok: true;
				goal: { id: number };
			};
			await caller.tdd_behavior_create({ goalId: g1.goal.id, behavior: "a" });
			await caller.tdd_behavior_create({ goalId: g2.goal.id, behavior: "b" });
			const r = (await caller.tdd_behavior_list({ scope: "session", sessionId: tddId })) as {
				ok: true;
				behaviors: ReadonlyArray<{ behavior: string }>;
			};
			expect(r.behaviors.map((b) => b.behavior).sort()).toEqual(["a", "b"]);
		});

		it("tdd_behavior_delete cascades dependency rows", async () => {
			const tddId = await seedTddSession("cc-mcp-beh-delete");
			const caller = createTestCaller();
			const goal = (await caller.tdd_goal_create({ sessionId: tddId, goal: "G" })) as {
				ok: true;
				goal: { id: number };
			};
			const dep = (await caller.tdd_behavior_create({ goalId: goal.goal.id, behavior: "dep" })) as {
				ok: true;
				behavior: { id: number };
			};
			const target = (await caller.tdd_behavior_create({
				goalId: goal.goal.id,
				behavior: "target",
				dependsOnBehaviorIds: [dep.behavior.id],
			})) as { ok: true; behavior: { id: number } };
			const del = (await caller.tdd_behavior_delete({ id: target.behavior.id })) as { ok: true };
			expect(del.ok).toBe(true);
			const fetched = (await caller.tdd_behavior_get({ id: target.behavior.id })) as { found: false };
			expect(fetched.found).toBe(false);
		});
	});
});
