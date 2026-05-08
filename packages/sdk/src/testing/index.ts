import { Effect, Layer } from "effect";
import { DataStore } from "../services/DataStore.js";
import { makeTestLayer } from "./layers.js";

export { DataStoreError } from "../errors/DataStoreError.js";
export type { IllegalStatusTransitionEntity, TddSessionEndOutcome } from "../errors/TddErrors.js";
export {
	BehaviorNotFoundError,
	GoalNotFoundError,
	IllegalStatusTransitionError,
	TddSessionAlreadyEndedError,
	TddSessionNotFoundError,
} from "../errors/TddErrors.js";
// Re-export service tags and error types whose names appear in the bundled
// declaration signatures so rslib can resolve them without inlining them as
// non-exported interfaces (which causes TS4023 in consumers).
export { DataReader } from "../services/DataReader.js";
export { DataStore } from "../services/DataStore.js";
export { DataStoreTestLayer, makeTestLayer } from "./layers.js";

export function empty(filename: string) {
	return makeTestLayer(filename);
}

export function singlePassingRun(filename: string) {
	const base = makeTestLayer(filename);
	const seed = Effect.gen(function* () {
		const store = yield* DataStore;
		yield* store.writeSettings("hash-preset-spr", { vitest_version: "4.1.5", pool: "forks" }, {});
		const runId = yield* store.writeRun({
			invocationId: "inv-preset-spr-1",
			project: "default",
			settingsHash: "hash-preset-spr",
			timestamp: "2026-01-01T00:00:00.000Z",
			commitSha: null,
			branch: null,
			reason: "passed",
			duration: 1200,
			total: 3,
			passed: 3,
			failed: 0,
			skipped: 0,
			scoped: false,
		});
		const fileId = yield* store.ensureFile("src/math.test.ts");
		const [moduleId] = yield* store.writeModules(runId, [
			{
				fileId,
				relativeModuleId: "src/math.test.ts",
				state: "passed",
				duration: 1200,
			},
		]);
		yield* store.writeTestCases(moduleId, [
			{
				name: "adds two numbers",
				fullName: "math > adds two numbers",
				state: "passed",
				duration: 400,
			},
			{
				name: "subtracts two numbers",
				fullName: "math > subtracts two numbers",
				state: "passed",
				duration: 400,
			},
			{
				name: "multiplies two numbers",
				fullName: "math > multiplies two numbers",
				state: "passed",
				duration: 400,
			},
		]);
	});
	return Layer.effectDiscard(seed).pipe(Layer.provideMerge(base));
}

export function withFailures(filename: string) {
	const base = makeTestLayer(filename);
	const seed = Effect.gen(function* () {
		const store = yield* DataStore;
		yield* store.writeSettings("hash-preset-wf", { vitest_version: "4.1.5", pool: "forks" }, {});
		const runId = yield* store.writeRun({
			invocationId: "inv-preset-wf-1",
			project: "default",
			settingsHash: "hash-preset-wf",
			timestamp: "2026-01-01T00:00:00.000Z",
			commitSha: null,
			branch: null,
			reason: "failed",
			duration: 1500,
			total: 4,
			passed: 2,
			failed: 2,
			skipped: 0,
			scoped: false,
		});
		const fileId = yield* store.ensureFile("src/parser.test.ts");
		const [moduleId] = yield* store.writeModules(runId, [
			{
				fileId,
				relativeModuleId: "src/parser.test.ts",
				state: "failed",
				duration: 1500,
			},
		]);
		yield* store.writeTestCases(moduleId, [
			{
				name: "parses valid input",
				fullName: "parser > parses valid input",
				state: "passed",
				duration: 300,
			},
			{
				name: "parses nested structure",
				fullName: "parser > parses nested structure",
				state: "passed",
				duration: 300,
			},
			{
				name: "rejects empty input",
				fullName: "parser > rejects empty input",
				state: "failed",
				duration: 450,
			},
			{
				name: "rejects malformed input",
				fullName: "parser > rejects malformed input",
				state: "failed",
				duration: 450,
			},
		]);
	});
	return Layer.effectDiscard(seed).pipe(Layer.provideMerge(base));
}

export function flaky(filename: string) {
	const base = makeTestLayer(filename);
	const seed = Effect.gen(function* () {
		const store = yield* DataStore;
		yield* store.writeSettings("hash-preset-flaky", { vitest_version: "4.1.5", pool: "forks" }, {});
		const runId1 = yield* store.writeRun({
			invocationId: "inv-preset-flaky-1",
			project: "default",
			settingsHash: "hash-preset-flaky",
			timestamp: "2026-01-01T00:00:00.000Z",
			commitSha: null,
			branch: null,
			reason: "failed",
			duration: 800,
			total: 2,
			passed: 1,
			failed: 1,
			skipped: 0,
			scoped: false,
		});
		const fileId = yield* store.ensureFile("src/async.test.ts");
		const [moduleId1] = yield* store.writeModules(runId1, [
			{
				fileId,
				relativeModuleId: "src/async.test.ts",
				state: "failed",
				duration: 800,
			},
		]);
		yield* store.writeTestCases(moduleId1, [
			{
				name: "resolves within timeout",
				fullName: "async > resolves within timeout",
				state: "failed",
				duration: 500,
			},
			{
				name: "rejects on error",
				fullName: "async > rejects on error",
				state: "passed",
				duration: 300,
			},
		]);
		yield* store.writeHistory(
			"default",
			"async > resolves within timeout",
			runId1,
			"2026-01-01T00:00:00.000Z",
			"failed",
			500,
			false,
			0,
			null,
		);
		yield* store.writeHistory(
			"default",
			"async > rejects on error",
			runId1,
			"2026-01-01T00:00:00.000Z",
			"passed",
			300,
			false,
			0,
			null,
		);
		const runId2 = yield* store.writeRun({
			invocationId: "inv-preset-flaky-2",
			project: "default",
			settingsHash: "hash-preset-flaky",
			timestamp: "2026-01-01T01:00:00.000Z",
			commitSha: null,
			branch: null,
			reason: "passed",
			duration: 700,
			total: 2,
			passed: 2,
			failed: 0,
			skipped: 0,
			scoped: false,
		});
		const [moduleId2] = yield* store.writeModules(runId2, [
			{
				fileId,
				relativeModuleId: "src/async.test.ts",
				state: "passed",
				duration: 700,
			},
		]);
		yield* store.writeTestCases(moduleId2, [
			{
				name: "resolves within timeout",
				fullName: "async > resolves within timeout",
				state: "passed",
				duration: 400,
			},
			{
				name: "rejects on error",
				fullName: "async > rejects on error",
				state: "passed",
				duration: 300,
			},
		]);
		yield* store.writeHistory(
			"default",
			"async > resolves within timeout",
			runId2,
			"2026-01-01T01:00:00.000Z",
			"passed",
			400,
			false,
			0,
			null,
		);
		yield* store.writeHistory(
			"default",
			"async > rejects on error",
			runId2,
			"2026-01-01T01:00:00.000Z",
			"passed",
			300,
			false,
			0,
			null,
		);
	});
	return Layer.effectDiscard(seed).pipe(Layer.provideMerge(base));
}

export function withTddSession(filename: string) {
	const base = makeTestLayer(filename);
	const seed = Effect.gen(function* () {
		const store = yield* DataStore;
		const sessionId = yield* store.writeSession({
			cc_session_id: "cc-preset-tdd",
			project: "default",
			cwd: "/workspace",
			agent_kind: "main",
			started_at: "2026-01-01T00:00:00.000Z",
		});
		const tddId = yield* store.writeTddSession({
			sessionId,
			goal: "Implement the parser feature",
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		const goal = yield* store.createGoal({
			sessionId: tddId,
			goal: "Handle edge cases",
		});
		yield* store.createBehavior({
			goalId: goal.id,
			behavior: "rejects empty input",
		});
		yield* store.createBehavior({
			goalId: goal.id,
			behavior: "rejects null input",
		});
	});
	return Layer.effectDiscard(seed).pipe(Layer.provideMerge(base));
}
