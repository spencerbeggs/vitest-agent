/**
 * Pure projection from `RunEvent` to `RenderState`.
 *
 * The reducer is the single source of truth for "what events mean for
 * the rendered view." Both the Ink human-mode renderer and the agent
 * string renderer consume the projected state — they never read the
 * raw event stream. Adding a variant to `RunEvent` produces a
 * compile-time failure at `Match.exhaustive` until the reducer
 * handles it.
 */

import type { FailureRecord, ModuleRecord, RenderState, RenderTotals, RunEvent, TestRecord } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { Match } from "effect";

const queuedModule = (modulePath: string, projectName?: string): ModuleRecord => ({
	modulePath,
	status: "queued",
	passCount: 0,
	failCount: 0,
	skipCount: 0,
	timeoutCount: 0,
	durationMs: 0,
	tests: [],
	...(projectName !== undefined && { projectName }),
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
	let timeoutCount = 0;
	let durationMs = 0;
	for (const m of Object.values(modules)) {
		passCount += m.passCount;
		failCount += m.failCount;
		skipCount += m.skipCount;
		timeoutCount += m.timeoutCount;
		durationMs += m.durationMs;
	}
	return { passCount, failCount, skipCount, timeoutCount, durationMs };
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
 *
 * @param state - the current render state
 * @param event - the run event to apply
 * @returns the next render state
 * @public
 */
export const reduceRenderState = (state: RenderState, event: RunEvent): RenderState => {
	// `Match.tagsExhaustive` takes the whole tag→handler map as one
	// `pipe` argument. The `RunEvent` union has 23 variants; the
	// per-`Match.tag` form would blow past `pipe`'s 20-argument overload
	// ceiling. The exhaustiveness guarantee is unchanged — a new variant
	// without a handler here is still a compile error.
	const noop = (): RenderState => state;
	return Match.value(event).pipe(
		Match.tagsExhaustive({
			// Watch mode reruns deliver a fresh `RunStarted` with a new
			// `runId`. The new run must paint into a clean slate — modules,
			// totals, coverage, trend, failures, and suggestedActions from
			// the previous run all reset. The Static history rendered by
			// `StreamApp` is keyed off `runId`; the renderer's own commit
			// map resets in lockstep with this reducer reset.
			RunStarted: (e) => ({
				...initialRenderState,
				phase: "running" as const,
				runId: e.runId,
				configHash: e.configHash,
				startedAt: e.startedAt,
			}),
			ModuleQueued: (e) => appendModuleIfNew(state, e.modulePath, () => queuedModule(e.modulePath, e.projectName)),
			ModuleStarted: (e) =>
				updateModule(state, e.modulePath, (m) => ({
					...m,
					status: "running",
					startedAt: e.startedAt,
					...(e.projectName !== undefined && { projectName: e.projectName }),
				})),
			TestStarted: (e) =>
				updateModule(state, e.modulePath, (m) =>
					upsertTest(m, e.testName, e.suitePath, {
						status: "running",
						durationMs: null,
					}),
				),
			TestFinished: (e) => {
				const status = e.timedOut === true ? ("timed-out" as const) : e.status;
				const withTest = updateModule(state, e.modulePath, (m) =>
					upsertTest(m, e.testName, e.suitePath, {
						status,
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
						...(e.timedOut === true && { timedOut: true }),
						classification: null,
					}),
				};
			},
			ModuleFinished: (e) => {
				const next = updateModule(state, e.modulePath, (m) => ({
					...m,
					status: "finished",
					passCount: e.passCount,
					failCount: e.failCount,
					skipCount: e.skipCount,
					timeoutCount: e.timeoutCount ?? 0,
					durationMs: e.durationMs,
					...(e.projectName !== undefined && { projectName: e.projectName }),
					...(e.tagCounts !== undefined && { tagCounts: e.tagCounts }),
				}));
				return { ...next, totals: recomputeTotals(next.modules) };
			},
			CoverageReady: (e) => ({
				...state,
				coverage: {
					metrics: e.metrics,
					thresholds: e.thresholds,
					gaps: e.gaps,
					violations: state.coverage?.violations ?? [],
				},
			}),
			ThresholdViolation: (e) => {
				if (state.coverage === null) return state;
				return {
					...state,
					coverage: {
						...state.coverage,
						violations: [...state.coverage.violations, { metric: e.metric, expected: e.expected, actual: e.actual }],
					},
				};
			},
			FailureClassified: (e) => ({
				...state,
				failures: state.failures.map((f) =>
					f.modulePath === e.modulePath && f.testName === e.testName ? { ...f, classification: e.classification } : f,
				),
			}),
			SuggestedAction: (e) => ({
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
			}),
			RunFinished: (e) => ({
				...state,
				phase: "finished" as const,
				finishedAt: e.finishedAt,
				totals: {
					passCount: e.passCount,
					failCount: e.failCount,
					skipCount: e.skipCount,
					timeoutCount: e.timeoutCount ?? state.totals.timeoutCount,
					durationMs: e.durationMs,
				},
			}),
			// `RunTimedOut` is terminal — `onProcessTimeout` ended the run.
			// Move to a terminal phase so the renderer paints a final frame
			// instead of waiting forever for a `RunFinished` that never comes.
			RunTimedOut: () => ({ ...state, phase: "timed-out" as const }),
			// Completeness variants (Part A §3.3). These are delivered to
			// every PubSub subscriber and the `onRunEvent` tap so analytics
			// consumers and the planned MCP dashboard receive them, but the
			// terminal renderer does not fold them into `RenderState` today —
			// they pass through as no-ops. A future consumer opts in without
			// any plugin change.
			ModuleCollected: noop,
			SuiteStarted: noop,
			SuiteFinished: noop,
			HookStarted: noop,
			HookFinished: noop,
			ConsoleLog: noop,
			TestAnnotated: noop,
			TestArtifactRecorded: noop,
			WatcherReady: noop,
			WatcherRerun: noop,
			TrendComputed: (e) => ({
				...state,
				trend: { direction: e.direction, runCount: e.runCount },
			}),
		}),
	);
};

/**
 * Fold a sequence of events into a final `RenderState`.
 *
 * Convenience for tests, replays, and the agent renderer's
 * accumulate-then-render-once path.
 *
 * @param events - the ordered event sequence to fold
 * @param seed - the initial render state (defaults to `initialRenderState`)
 * @returns the terminal render state after all events are applied
 * @public
 */
export const reduceRenderStateAll = (
	events: ReadonlyArray<RunEvent>,
	seed: RenderState = initialRenderState,
): RenderState => events.reduce<RenderState>(reduceRenderState, seed);
