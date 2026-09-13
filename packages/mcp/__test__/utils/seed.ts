/**
 * Shared seed for the Effect-native tool tests: one passing run for the
 * `default` project with a module, a suite, two test cases, coverage and
 * a trend entry — the same shape `tool-handlers.test.ts` seeds for the direct
 * caller — plus a second, failing project carrying an annotated error.
 * Runs against whatever `DataStore` is in context (the harness's fresh
 * in-memory store, or a test's own `ManagedRuntime`).
 */

import { DataStore } from "@vitest-agent/engine";
import { Effect } from "effect";

export const SEED_PROJECT = "default";
export const SEED_MODULE = "src/utils.test.ts";
export const SEED_SOURCE_FILE = "src/utils.ts";
export const SEED_SETTINGS_HASH = "abc123";
export const SEED_ERROR_PROJECT = "errors-proj";
export const SEED_ERROR_MODULE = "src/failing.test.ts";
export const SEED_ERROR_FULL_NAME = "failing > blows up";
export const SEED_SIGNATURE_HASH = "abc123def456cafe";
export const SEED_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
export const SEED_CHAT_ID = "11111111-2222-4333-8444-555555555555";

export const seedReadonlyFixture: Effect.Effect<void, never, DataStore> = Effect.gen(function* () {
	const store = yield* DataStore;

	yield* store.writeSettings(
		SEED_SETTINGS_HASH,
		{ vitestVersion: "3.2.0", pool: "forks", coverageProvider: "v8" },
		{ CI: "true", NODE_ENV: "test" },
	);
	const runId = yield* store.writeRun({
		invocationId: "inv-001",
		project: SEED_PROJECT,
		settingsHash: SEED_SETTINGS_HASH,
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
	const fileId = yield* store.ensureFile(SEED_MODULE);
	const moduleIds = yield* store.writeModules(runId, [
		{ fileId, relativeModuleId: SEED_MODULE, state: "passed", duration: 500 },
	]);
	yield* store.writeSuites(moduleIds[0], [{ name: "utils", fullName: "utils", state: "passed" }]);
	yield* store.writeTestCases(moduleIds[0], [
		{ name: "adds numbers", fullName: "utils > adds numbers", state: "passed", duration: 10 },
		{ name: "subtracts numbers", fullName: "utils > subtracts numbers", state: "passed", duration: 5 },
	]);
	const srcFileId = yield* store.ensureFile(SEED_SOURCE_FILE);
	yield* store.writeCoverage(runId, [
		{ fileId: srcFileId, statements: 85.5, branches: 70.0, functions: 90.0, lines: 85.0, uncoveredLines: "42-50" },
	]);
	yield* store.writeTrends(SEED_PROJECT, runId, {
		timestamp: "2026-03-25T10:00:00.000Z",
		coverage: { statements: 85.5, branches: 70.0, functions: 90.0, lines: 85.0 },
		delta: { statements: 1.0, branches: 0.5, functions: 0.0, lines: 1.0 },
		direction: "improving",
	});

	// A failing project: one test-scoped error on an annotated test and one
	// module-scoped error with no test, plus a failure signature.
	const errorRunId = yield* store.writeRun({
		invocationId: "inv-err-001",
		project: SEED_ERROR_PROJECT,
		settingsHash: SEED_SETTINGS_HASH,
		timestamp: "2026-03-25T11:00:00.000Z",
		commitSha: null,
		branch: null,
		reason: "failed",
		duration: 10,
		total: 1,
		passed: 0,
		failed: 1,
		skipped: 0,
		scoped: false,
	});
	const errorFileId = yield* store.ensureFile(SEED_ERROR_MODULE);
	const [errorModuleId] = yield* store.writeModules(errorRunId, [
		{ fileId: errorFileId, relativeModuleId: SEED_ERROR_MODULE, state: "failed", duration: 5 },
	]);
	const [testCaseId] = yield* store.writeTestCases(errorModuleId, [
		{ name: "blows up", fullName: SEED_ERROR_FULL_NAME, state: "failed" },
	]);
	yield* store.writeAnnotations(errorRunId, [
		{
			testCaseId,
			type: "issues",
			message: "flaky under load",
			locationFile: SEED_ERROR_MODULE,
			locationLine: 4,
			locationColumn: 1,
			attachments: [],
		},
	]);
	yield* store.writeErrors(errorRunId, [
		{ testCaseId, scope: "test", name: "AssertionError", message: "expected 3 to equal 2" },
		{ moduleId: errorModuleId, scope: "module", name: "SyntaxError", message: "unexpected token" },
	]);
	yield* store.writeFailureSignature({
		signatureHash: SEED_SIGNATURE_HASH,
		runId: errorRunId,
		seenAt: "2026-03-25T11:00:00.000Z",
	});

	// A recorded commit, a session and one turn for the diagnostics tools.
	yield* store.writeCommit({
		sha: SEED_COMMIT_SHA,
		message: "feat: seed commit",
		author: "Seed <seed@example.com>",
		committedAt: "2026-03-25T09:00:00.000Z",
		branch: "main",
	});
	const sessionId = yield* store.writeSession({
		chatId: SEED_CHAT_ID,
		project: SEED_PROJECT,
		cwd: "/tmp/seed",
		agentKind: "main",
		startedAt: "2026-03-25T08:00:00.000Z",
	});
	yield* store.writeTurn({
		sessionId,
		type: "user_prompt",
		payload: JSON.stringify({ text: "hello" }),
		occurredAt: "2026-03-25T08:01:00.000Z",
	});
}).pipe(Effect.orDie);
