/**
 * Pure projection from {@link RunEvent} to {@link RenderState}.
 *
 * The reducer is the single source of truth for "what events mean for
 * the rendered view." Both the Ink human-mode renderer and the agent
 * string renderer consume the projected state — they never read the
 * raw event stream. Adding a variant to `RunEvent` produces a
 * compile-time failure at `Match.exhaustive` until the reducer
 * handles it.
 *
 * @packageDocumentation
 */

import { Match } from "effect";
import type { FailureRecord, ModuleRecord, RenderState, RenderTotals, RunEvent, TestRecord } from "vitest-agent-sdk";
import { initialRenderState } from "vitest-agent-sdk";

const queuedModule = (modulePath: string): ModuleRecord => ({
	modulePath,
	status: "queued",
	passCount: 0,
	failCount: 0,
	skipCount: 0,
	durationMs: 0,
	tests: [],
});

const appendModuleIfNew = (state: RenderState, modulePath: string, make: () => ModuleRecord): RenderState => {
	if (state.modules[modulePath] !== undefined) return state;
	return {
		...state,
		modules: { ...state.modules, [modulePath]: make() },
		moduleOrder: [...state.moduleOrder, modulePath],
	};
};

const updateModule = (
	state: RenderState,
	modulePath: string,
	update: (current: ModuleRecord) => ModuleRecord,
): RenderState => {
	const current = state.modules[modulePath];
	if (current === undefined) {
		const seeded = update(queuedModule(modulePath));
		return {
			...state,
			modules: { ...state.modules, [modulePath]: seeded },
			moduleOrder: [...state.moduleOrder, modulePath],
		};
	}
	return {
		...state,
		modules: { ...state.modules, [modulePath]: update(current) },
	};
};

const upsertTest = (
	module: ModuleRecord,
	testName: string,
	suitePath: ReadonlyArray<string>,
	patch: Omit<TestRecord, "testName" | "suitePath">,
): ModuleRecord => {
	const idx = module.tests.findIndex((t) => t.testName === testName && samePath(t.suitePath, suitePath));
	const next: TestRecord = { testName, suitePath, ...patch };
	if (idx === -1) {
		return { ...module, tests: [...module.tests, next] };
	}
	const tests = module.tests.slice();
	tests[idx] = next;
	return { ...module, tests };
};

const samePath = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
};

const recomputeTotals = (modules: Record<string, ModuleRecord>): RenderTotals => {
	let passCount = 0;
	let failCount = 0;
	let skipCount = 0;
	let durationMs = 0;
	for (const m of Object.values(modules)) {
		passCount += m.passCount;
		failCount += m.failCount;
		skipCount += m.skipCount;
		durationMs += m.durationMs;
	}
	return { passCount, failCount, skipCount, durationMs };
};

const upsertFailure = (failures: ReadonlyArray<FailureRecord>, next: FailureRecord): FailureRecord[] => {
	const idx = failures.findIndex(
		(f) => f.modulePath === next.modulePath && f.testName === next.testName && samePath(f.suitePath, next.suitePath),
	);
	if (idx === -1) return [...failures, next];
	const out = failures.slice();
	out[idx] = { ...failures[idx], ...next };
	return out;
};

/**
 * Apply a single event to the previous state and return the next.
 *
 * The function is pure: no I/O, no time, no randomness. Folding it
 * over an event sequence yields the same state regardless of when the
 * fold runs.
 */
export const reduceRenderState = (state: RenderState, event: RunEvent): RenderState =>
	Match.value(event).pipe(
		Match.tag("RunStarted", (e) => ({
			...state,
			phase: "running" as const,
			runId: e.runId,
			configHash: e.configHash,
			startedAt: e.startedAt,
			finishedAt: null,
		})),
		Match.tag("ModuleQueued", (e) => appendModuleIfNew(state, e.modulePath, () => queuedModule(e.modulePath))),
		Match.tag("ModuleStarted", (e) => updateModule(state, e.modulePath, (m) => ({ ...m, status: "running" }))),
		Match.tag("TestStarted", (e) =>
			updateModule(state, e.modulePath, (m) =>
				upsertTest(m, e.testName, e.suitePath, {
					status: "running",
					durationMs: null,
				}),
			),
		),
		Match.tag("TestFinished", (e) => {
			const withTest = updateModule(state, e.modulePath, (m) =>
				upsertTest(m, e.testName, e.suitePath, {
					status: e.status,
					durationMs: e.durationMs,
					...(e.error !== undefined && { error: e.error }),
				}),
			);
			if (e.status !== "failed") return withTest;
			return {
				...withTest,
				failures: upsertFailure(withTest.failures, {
					modulePath: e.modulePath,
					testName: e.testName,
					suitePath: e.suitePath,
					...(e.error !== undefined && { error: e.error }),
					classification: null,
				}),
			};
		}),
		Match.tag("ModuleFinished", (e) => {
			const next = updateModule(state, e.modulePath, (m) => ({
				...m,
				status: "finished",
				passCount: e.passCount,
				failCount: e.failCount,
				skipCount: e.skipCount,
				durationMs: e.durationMs,
			}));
			return { ...next, totals: recomputeTotals(next.modules) };
		}),
		Match.tag("CoverageReady", (e) => ({
			...state,
			coverage: {
				metrics: e.metrics,
				thresholds: e.thresholds,
				gaps: e.gaps,
				violations: state.coverage?.violations ?? [],
			},
		})),
		Match.tag("ThresholdViolation", (e) => {
			if (state.coverage === null) return state;
			return {
				...state,
				coverage: {
					...state.coverage,
					violations: [...state.coverage.violations, { metric: e.metric, expected: e.expected, actual: e.actual }],
				},
			};
		}),
		Match.tag("FailureClassified", (e) => ({
			...state,
			failures: state.failures.map((f) =>
				f.modulePath === e.modulePath && f.testName === e.testName ? { ...f, classification: e.classification } : f,
			),
		})),
		Match.tag("SuggestedAction", (e) => ({
			...state,
			suggestedActions: [
				...state.suggestedActions,
				{
					severity: e.severity,
					title: e.title,
					detail: e.detail,
					...(e.targetTool !== undefined && { targetTool: e.targetTool }),
				},
			],
		})),
		Match.tag("RunFinished", (e) => ({
			...state,
			phase: "finished" as const,
			finishedAt: e.finishedAt,
			totals: {
				passCount: e.passCount,
				failCount: e.failCount,
				skipCount: e.skipCount,
				durationMs: e.durationMs,
			},
		})),
		Match.exhaustive,
	);

/**
 * Fold a sequence of events into a final {@link RenderState}.
 *
 * Convenience for tests, replays, and the agent renderer's
 * accumulate-then-render-once path.
 */
export const reduceRenderStateAll = (
	events: ReadonlyArray<RunEvent>,
	seed: RenderState = initialRenderState,
): RenderState => events.reduce<RenderState>(reduceRenderState, seed);
