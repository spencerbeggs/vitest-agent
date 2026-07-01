import { Effect, Layer } from "effect";
import { DataStore } from "../services/DataStore.js";
import { makeTestLayer } from "./layers.js";

// Re-export all types that appear in DataStore / DataReader method signatures
// so that API Extractor can resolve them from the testing entry point.
// Agent errors
export { AgentNotFoundError, RegistrationConflictError } from "../errors/AgentErrors.js";
export { DataStoreError } from "../errors/DataStoreError.js";
export type { IllegalStatusTransitionEntity, TddTaskEndOutcome } from "../errors/TddErrors.js";
export {
	BehaviorNotFoundError,
	GoalNotFoundError,
	IllegalStatusTransitionError,
	TddTaskAlreadyEndedError,
	TddTaskNotFoundError,
} from "../errors/TddErrors.js";
// Agent schemas — classes carry both value and type
export { Agent, IdempotencyHit } from "../schemas/Agent.js";
// AgentReport schema — Schema const+type pair
export { AgentReport } from "../schemas/AgentReport.js";
// Baselines schema — Schema const+type pair
export { CoverageBaselines } from "../schemas/Baselines.js";
// CacheManifest schema — Schema const+type pair
export { CacheManifest } from "../schemas/CacheManifest.js";
// Coverage schemas — Schema const+type pairs
export { CoverageReport, FileCoverageReport } from "../schemas/Coverage.js";
// History schema — Schema const+type pair
export { HistoryRecord } from "../schemas/History.js";
// Identity schemas — Schema const+type pairs; `export { X }` covers both
export { AgentId, ChatId } from "../schemas/Identity.js";
// Tdd schemas — Schema const+type pairs
export { BehaviorDetail, BehaviorRow, BehaviorStatus, GoalDetail, GoalRow, GoalStatus } from "../schemas/Tdd.js";
// Trend schemas — Schema const+type pairs
export { TrendEntry, TrendRecord } from "../schemas/Trends.js";
// DataReader read/output types (all interfaces — type-only)
export type {
	AcceptanceMetrics,
	CitedArtifactRow,
	CommitChangesEntry,
	CurrentTddPhase,
	FailureSignatureDetail,
	FlakyTest,
	HypothesisDetail,
	ModuleListEntry,
	NoteRow,
	PersistentFailure,
	ProjectRunSummary,
	SessionDetail,
	SettingsListEntry,
	SettingsRow,
	SuiteListEntry,
	TagInventoryRow,
	TddArtifactDetail,
	TddArtifactRow,
	TddPhaseDetail,
	TddTaskDetail,
	TddTaskSummary,
	TestError,
	TestListEntry,
	TurnSearchOptions,
	TurnSummary,
} from "../services/DataReader.js";
// Re-export service tags and error types whose names appear in the bundled
// declaration signatures so rslib can resolve them without inlining them as
// non-exported interfaces (which causes TS4023 in consumers).
export { DataReader } from "../services/DataReader.js";
// DataStore write-input types (all interfaces / type aliases — type-only)
export type {
	AssociateRunSessionInput,
	ChangeKind,
	CreateBehaviorInput,
	CreateGoalInput,
	EndTddTaskInput,
	FailureSignatureWriteInput,
	FileCoverageInput,
	HypothesisInput,
	IdempotentResponseInput,
	ModuleInput,
	NoteInput,
	RegisterAgentInput,
	RunChangedFile,
	RunInvocationMethod,
	SessionInput,
	SettingsInput,
	StackFrameInput,
	SuiteInput,
	TddTaskInput,
	TestCaseInput,
	TestErrorInput,
	TestRunInput,
	TurnInput,
	UpdateBehaviorInput,
	UpdateGoalInput,
	ValidateHypothesisInput,
	WriteCommitInput,
	WriteRunChangedFilesInput,
	WriteTddArtifactInput,
	WriteTddPhaseInput,
	WriteTddPhaseOutput,
} from "../services/DataStore.js";
export { DataStore } from "../services/DataStore.js";
// Phase-transition pure types (no runtime values)
export type { ArtifactKind, CitedArtifact, Phase } from "../utils/validate-phase-transition.js";
export { DataStoreTestLayer, makeTestLayer } from "./layers.js";

/** @public */
export function empty(filename: string) {
	return makeTestLayer(filename);
}
/** @public */
export function singlePassingRun(filename: string) {
	const base = makeTestLayer(filename);
	const seed = Effect.gen(function* () {
		const store = yield* DataStore;
		yield* store.writeSettings("hash-preset-spr", { vitestVersion: "4.1.5", pool: "forks" }, {});
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
/** @public */
export function withFailures(filename: string) {
	const base = makeTestLayer(filename);
	const seed = Effect.gen(function* () {
		const store = yield* DataStore;
		yield* store.writeSettings("hash-preset-wf", { vitestVersion: "4.1.5", pool: "forks" }, {});
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
/** @public */
export function flaky(filename: string) {
	const base = makeTestLayer(filename);
	const seed = Effect.gen(function* () {
		const store = yield* DataStore;
		yield* store.writeSettings("hash-preset-flaky", { vitestVersion: "4.1.5", pool: "forks" }, {});
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
		// An earlier passing observation, so the run-1 failure is a
		// fail-AFTER-pass: genuine oscillation (pass -> fail -> pass), not a
		// clean fail -> pass recovery. getFlaky deliberately excludes monotonic
		// recoveries, so a flaky fixture must actually oscillate.
		yield* store.writeHistory(
			"default",
			"async > resolves within timeout",
			"src/async.test.ts",
			runId1,
			"2025-12-31T23:00:00.000Z",
			"passed",
			500,
			false,
			0,
			null,
		);
		yield* store.writeHistory(
			"default",
			"async > resolves within timeout",
			"src/async.test.ts",
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
			"src/async.test.ts",
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
			"src/async.test.ts",
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
			"src/async.test.ts",
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
/** @public */
export function withTddTask(filename: string) {
	const base = makeTestLayer(filename);
	const seed = Effect.gen(function* () {
		const store = yield* DataStore;
		const sessionId = yield* store.writeSession({
			chatId: "chat-preset-tdd",
			project: "default",
			cwd: "/workspace",
			agentKind: "main",
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		const tddTaskId = yield* store.writeTddTask({
			sessionId,
			goal: "Implement the parser feature",
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		const goal = yield* store.createGoal({
			tddTaskId,
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
