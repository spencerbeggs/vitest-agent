/**
 * vitest-agent-sdk
 *
 * Pure function for building an {@link AgentReport} from Vitest
 * TestModule/TestCase objects. No I/O -- data transformation only.
 *
 * @packageDocumentation
 */

import type { AgentReport, ModuleReport, TestReport } from "../schemas/AgentReport.js";
import type { ReportError } from "../schemas/Common.js";
import type { AgentReporterOptions } from "../schemas/Options.js";

// --- Duck-typed Vitest interfaces ---

/**
 * Duck-typed Vitest parsed stack frame.
 *
 * Vitest's TestError.stacks is `ParsedStack[]` from `@vitest/utils`, not a
 * plain string array. Frames must be formatted before joining; otherwise
 * `[obj].join("\n")` produces "[object Object]".
 *
 * @internal
 */
export interface VitestParsedStack {
	method: string;
	file: string;
	line: number;
	column: number;
}

/**
 * Duck-typed Vitest test error with message, optional diff, and stack traces.
 *
 * `stacks` accepts both already-formatted strings (legacy / coercion path)
 * and `ParsedStack[]` (real Vitest output).
 *
 * @internal
 */
export interface VitestTestError {
	message: string;
	diff?: string;
	stacks?: Array<string | VitestParsedStack>;
}

/**
 * Duck-typed Vitest test result returned by `TestCase.result()`.
 *
 * Vitest returns `undefined` for tests that have not finished running
 * (pending/collected state).
 *
 * @internal
 */
export interface VitestTestResult {
	state: string;
	errors?: ReadonlyArray<VitestTestError>;
}

/**
 * Duck-typed Vitest test diagnostic returned by `TestCase.diagnostic()`.
 *
 * @internal
 */
export interface VitestTestDiagnostic {
	duration: number;
	flaky: boolean;
	slow: boolean;
}

/**
 * Duck-typed Vitest TestCase from the Reporter v2 API.
 *
 * @remarks
 * These interfaces mirror the Vitest TestCase shape without importing
 * Vitest types directly, keeping the formatter a pure data transformer
 * with no dependency on the Vitest runtime.
 *
 * @internal
 */
export interface VitestTestCase {
	type: "test";
	name: string;
	fullName: string;
	tags: readonly string[];
	/** Parent suite or module. Optional in the duck-type so unit-test fixtures don't have to fabricate a stub; always present in real Vitest TestCase instances. */
	parent?: VitestTestSuite | VitestTestModule;
	result(): VitestTestResult | undefined;
	diagnostic(): VitestTestDiagnostic | undefined;
}

/**
 * Duck-typed Vitest module diagnostic.
 *
 * @internal
 */
export interface VitestModuleDiagnostic {
	duration: number;
}

/**
 * Duck-typed Vitest module error.
 *
 * @internal
 */
export interface VitestModuleError {
	message: string;
	stacks?: Array<string | VitestParsedStack>;
}

/**
 * Duck-typed Vitest TestModule from the Reporter v2 API.
 *
 * @remarks
 * Each `TestModule` carries a `.project` reference with a `.name` property,
 * which {@link AgentReporter} uses to group results by Vitest project in
 * monorepo configurations.
 *
 * @internal
 */
/**
 * Duck-typed Vitest TestSuite from the Reporter v2 API.
 *
 * @internal
 */
export interface VitestTestSuite {
	type: "suite";
	name: string;
	fullName: string;
	state(): string;
	parent: VitestTestSuite | VitestTestModule;
	options: {
		concurrent?: boolean;
		shuffle?: boolean;
		retry?: number;
		repeats?: number;
		mode?: string;
		tags?: string[];
	};
	location?: { line: number; column: number };
}

export interface VitestTestModule {
	type: "module";
	moduleId: string;
	relativeModuleId: string;
	project: { name: string };
	state(): string;
	children: {
		allTests(filter?: string): Generator<VitestTestCase>;
		allSuites(): Generator<VitestTestSuite>;
	};
	diagnostic(): VitestModuleDiagnostic | undefined;
	errors(): Array<VitestModuleError>;
}

// --- Helpers ---

/**
 * Format a single Vitest stack frame: strings pass through; ParsedStack
 * objects render as `at <method> (<file>:<line>:<column>)`. An empty
 * `method` falls back to `<anonymous>`.
 *
 * @internal
 */
function formatStackFrame(frame: string | VitestParsedStack): string {
	if (typeof frame === "string") return frame;
	const method = frame.method.length > 0 ? frame.method : "<anonymous>";
	return `at ${method} (${frame.file}:${frame.line}:${frame.column})`;
}

/**
 * Map Vitest error objects to the {@link ReportError} shape.
 *
 * @internal
 */
function mapErrors(
	errors: ReadonlyArray<VitestTestError> | Array<VitestModuleError> | undefined,
): ReportError[] | undefined {
	if (!errors || errors.length === 0) return undefined;
	return errors.map((e) => {
		return {
			message: e.message,
			...("diff" in e && e.diff != null ? { diff: e.diff } : {}),
			...(e.stacks && e.stacks.length > 0 ? { stack: e.stacks.map(formatStackFrame).join("\n") } : {}),
		};
	});
}

/**
 * Normalize a Vitest state string to one of the four canonical states.
 *
 * @internal
 */
function normalizeState(state: string): "passed" | "failed" | "skipped" | "pending" {
	if (state === "passed") return "passed";
	if (state === "failed") return "failed";
	if (state === "skipped") return "skipped";
	return "pending";
}

// --- buildAgentReport ---

/**
 * Convert Vitest TestModule/TestCase objects into an {@link AgentReport}.
 *
 * @remarks
 * This is a pure data transformation function with no I/O. It tallies
 * pass/fail/skip counts, extracts error details with diffs, and builds
 * the complete report structure. Only modules with at least one failing
 * test are included in the `failed` array to keep reports compact.
 *
 * @param testModules - All test modules from the Vitest run
 * @param unhandledErrors - Unhandled errors from the run
 * @param reason - Overall run outcome (`"passed"`, `"failed"`, or `"interrupted"`)
 * @param options - Reporter options; only `omitPassingTests` is used
 * @param projectName - Optional project name for monorepo grouping
 * @returns Structured report ready for JSON serialization
 *
 * @internal
 */
export function buildAgentReport(
	testModules: ReadonlyArray<VitestTestModule>,
	unhandledErrors: ReadonlyArray<VitestModuleError>,
	reason: "passed" | "failed" | "interrupted",
	options: Pick<AgentReporterOptions, "omitPassingTests">,
	projectName?: string,
): AgentReport {
	const omitPassing = options.omitPassingTests !== false; // default true

	let totalCount = 0;
	let passedCount = 0;
	let failedCount = 0;
	let skippedCount = 0;
	let totalDuration = 0;

	const failedModules: ModuleReport[] = [];
	const failedFiles: string[] = [];

	for (const testModule of testModules) {
		const moduleDuration = testModule.diagnostic()?.duration ?? 0;
		totalDuration += moduleDuration;

		const moduleState = normalizeState(testModule.state());
		const moduleErrors = mapErrors(testModule.errors());

		// Collect all tests and tally counts
		const allTests = [...testModule.children.allTests()];
		const testReports: TestReport[] = [];

		let moduleHasFailure = false;

		for (const testCase of allTests) {
			totalCount++;
			const result = testCase.result();
			const diag = testCase.diagnostic();
			const state = normalizeState(result?.state ?? "pending");

			if (state === "passed") passedCount++;
			else if (state === "failed") {
				failedCount++;
				moduleHasFailure = true;
			} else if (state === "skipped") skippedCount++;
			else skippedCount++; // pending counts as skipped for summary

			// Include test in report based on omitPassingTests
			const shouldInclude = !omitPassing || state !== "passed";
			if (shouldInclude) {
				const errors = mapErrors(result?.errors);
				const testReport: TestReport = {
					name: testCase.name,
					fullName: testCase.fullName,
					state,
					...(diag?.duration !== undefined ? { duration: diag.duration } : {}),
					...(diag?.flaky ? { flaky: true } : {}),
					...(diag?.slow ? { slow: true } : {}),
					...(errors ? { errors } : {}),
				};
				testReports.push(testReport);
			}
		}

		// A module is "failed" in the report when either:
		//   - at least one of its test cases failed, OR
		//   - the module itself failed before its tests could run (a
		//     collection-time error: import failure, syntax error, or
		//     beforeAll throw). In that second case `allTests` is empty
		//     and `moduleHasFailure` stays false, so we additionally
		//     check the module's own state + errors so the agent sees
		//     the file in `failed[]` instead of a misleading "0 passed".
		const isCollectionFailure = !moduleHasFailure && moduleState === "failed" && moduleErrors !== undefined;
		if (moduleHasFailure || isCollectionFailure) {
			failedFiles.push(testModule.relativeModuleId);
			const moduleReport: ModuleReport = {
				file: testModule.relativeModuleId,
				state: moduleState,
				duration: moduleDuration,
				tests: testReports,
				...(moduleErrors ? { errors: moduleErrors } : {}),
			};
			failedModules.push(moduleReport);
		}
	}

	const mappedUnhandled = mapErrors(unhandledErrors) ?? [];

	return {
		timestamp: new Date().toISOString(),
		...(projectName != null ? { project: projectName } : {}),
		reason,
		summary: {
			total: totalCount,
			passed: passedCount,
			failed: failedCount,
			skipped: skippedCount,
			duration: totalDuration,
		},
		failed: failedModules,
		unhandledErrors: mappedUnhandled,
		failedFiles,
	};
}
