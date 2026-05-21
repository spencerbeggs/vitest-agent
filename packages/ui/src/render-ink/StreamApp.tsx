/**
 * Root Ink component for the `stream` console mode — an agent-shaped,
 * lifecycle-aware live renderer that renders the entire run picture in
 * a single dynamic region.
 *
 * Everything lives in the Live region. On a terminal event
 * (`RunFinished` / `RunTimedOut`), the caller (LiveInkRenderer) simply
 * calls `instance.unmount()` and lets Ink commit the final frame: Ink's
 * interactive unmount flushes the pending render, redraws the final frame
 * one last time, then leaves it in place so it lands in terminal
 * scrollback as ordinary content. A plain-text `renderToString` write
 * survives only as the degraded fallback when the Ink mount could not
 * attach (a non-TTY stream). See `LiveInkRenderer`'s terminal-event
 * commit note for the full lifecycle.
 *
 * Per-shape granularity:
 *
 * | Shape | Live region |
 * | ----- | ----------- |
 * | `workspace` | `Projects (N):` header + all project rows (finished with resolved glyph, running with spinner, capped at MAX_LIVE_RUNNING_ROWS for running rows) + overflow line + Failures + Coverage + Trend + Total |
 * | `single-project` | `Modules (N):` header + all module rows (finished with resolved glyph, running with spinner, capped) + overflow line + Failures + Coverage + Trend + Total |
 * | `single-file` | `<file-path> — N tests` header + all test rows (finished with resolved glyph, running with spinner), each failing row expanding its error inline + Coverage + Trend + Total |
 * | `single-test` | the single `TestRow`, in place (Live-only by spec §11.7) |
 *
 * Leaf shapes (`single-file`, `single-test`) expand each failure inline
 * beneath its row and omit the aggregate `Failures` section, so a failure
 * is never printed twice. Aggregate shapes (`workspace`, `single-project`)
 * render rows without inline errors and rely on the `Failures` section.
 *
 * Running rows beyond MAX_LIVE_RUNNING_ROWS are hidden and replaced with
 * a single "… and N more running" overflow line. Finished rows always
 * appear regardless of count.
 *
 * @packageDocumentation
 */

import { Box, Text } from "ink";
import type { FC, ReactNode } from "react";
import type { FailureRecord, ModuleRecord, ProjectSummary, RenderState, TestRecord } from "vitest-agent-sdk";
import { classifyRunShape } from "../dispatcher/classify.js";
import { formatDisplayDuration } from "../format-duration.js";
import { CountColumns } from "./CountColumns.js";
import { ProjectRow } from "./ProjectRow.js";
import { StatusIcon } from "./StatusIcon.js";
import { spinnerFrame } from "./spinner.js";
import { TestRow } from "./TestRow.js";
import { TrendLine } from "./TrendLine.js";
import { formatTagSuffix } from "./tag-suffix.js";

export interface StreamAppProps {
	readonly state: RenderState;
	readonly frameIndex: number;
	readonly nowMs?: number;
}

const ANONYMOUS_PROJECT = "default";

/** Maximum number of running rows displayed in the Live region. Beyond this,
 *  excess running units collapse into a single "… and N more running" line. */
const MAX_LIVE_RUNNING_ROWS = 4;

interface ProjectGroup {
	readonly name: string;
	readonly modules: ReadonlyArray<ModuleRecord>;
}

const groupByProject = (state: RenderState): ReadonlyArray<ProjectGroup> => {
	const order: string[] = [];
	const byName = new Map<string, ModuleRecord[]>();
	for (const path of state.moduleOrder) {
		const mod = state.modules[path];
		if (mod === undefined) continue;
		const name = mod.projectName ?? ANONYMOUS_PROJECT;
		const existing = byName.get(name);
		if (existing === undefined) {
			byName.set(name, [mod]);
			order.push(name);
		} else {
			existing.push(mod);
		}
	}
	return order.map((name) => ({ name, modules: byName.get(name) ?? [] }));
};

const moduleRunning = (m: ModuleRecord): boolean => m.status !== "finished";

const moduleElapsedMs = (m: ModuleRecord, nowMs: number): number => {
	if (m.status === "finished") return m.durationMs;
	if (m.startedAt === undefined) return 0;
	const started = Date.parse(m.startedAt);
	return Number.isNaN(started) ? 0 : Math.max(0, nowMs - started);
};

interface Counts {
	passCount: number;
	failCount: number;
	skipCount: number;
	timeoutCount: number;
}

const sumCounts = (modules: ReadonlyArray<ModuleRecord>): Counts => {
	let passCount = 0;
	let failCount = 0;
	let skipCount = 0;
	let timeoutCount = 0;
	for (const m of modules) {
		passCount += m.passCount;
		failCount += m.failCount;
		skipCount += m.skipCount;
		timeoutCount += m.timeoutCount;
	}
	return { passCount, failCount, skipCount, timeoutCount };
};

const mergeTagCounts = (modules: ReadonlyArray<ModuleRecord>): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const m of modules) {
		for (const [tag, count] of Object.entries(m.tagCounts ?? {})) {
			out[tag] = (out[tag] ?? 0) + count;
		}
	}
	return out;
};

const projectElapsedMs = (group: ProjectGroup, nowMs: number): number => {
	if (!group.modules.some(moduleRunning)) {
		let total = 0;
		for (const m of group.modules) total += m.durationMs;
		return total;
	}
	let earliest = Number.POSITIVE_INFINITY;
	for (const m of group.modules) {
		if (m.startedAt === undefined) continue;
		const started = Date.parse(m.startedAt);
		if (!Number.isNaN(started) && started < earliest) earliest = started;
	}
	return earliest === Number.POSITIVE_INFINITY ? 0 : Math.max(0, nowMs - earliest);
};

const moduleIcon = (m: ModuleRecord): "passed" | "failed" | "timed-out" | "skipped" => {
	if (m.failCount > 0) return "failed";
	if (m.timeoutCount > 0) return "timed-out";
	// Skip-only: at least one skip and no passes / fails / timeouts. Avoids
	// painting a false-positive ✓ on a module whose tests were all skipped.
	if (m.skipCount > 0 && m.passCount === 0) return "skipped";
	return "passed";
};

/**
 * One `single-project`-shape row: a module with the four count columns.
 *
 * Used in the Live region for both running rows (spinner, `running=true`)
 * and finished rows (resolved glyph, `running=false`).
 */
const ModuleStreamRow: FC<{
	module: ModuleRecord;
	nowMs: number;
	frame: string;
	nameWidth: number;
	timedOut: boolean;
}> = ({ module, nowMs, frame, nameWidth, timedOut }) => {
	const running = moduleRunning(module);
	// When the run has been timed out, modules previously in "running" or
	// "queued" must not keep spinning. A running-at-timeout module resolves
	// to ⧖. A queued-but-never-started module keeps the `·` glyph and adds
	// a dim "not started" suffix.
	const queued = module.status === "queued";
	let glyph: ReactNode;
	let notStartedSuffix: ReactNode = null;
	if (timedOut && running) {
		if (queued) {
			glyph = <StatusIcon status="queued" />;
			notStartedSuffix = <Text dimColor> not started — killed before reaching this module</Text>;
		} else {
			glyph = <StatusIcon status="timed-out" />;
		}
	} else if (running) {
		glyph = <Text color="yellow">{frame}</Text>;
	} else {
		glyph = <StatusIcon status={moduleIcon(module)} />;
	}
	return (
		<Box>
			<Text>{"  "}</Text>
			{glyph}
			<Text> {module.modulePath.padEnd(nameWidth)} </Text>
			<CountColumns
				passCount={module.passCount}
				failCount={module.failCount}
				skipCount={module.skipCount}
				timeoutCount={module.timeoutCount}
			/>
			<Text dimColor> {formatDisplayDuration(moduleElapsedMs(module, nowMs))}</Text>
			{formatTagSuffix(module.tagCounts).length > 0 ? (
				<Text color="cyan"> {formatTagSuffix(module.tagCounts)}</Text>
			) : null}
			{notStartedSuffix}
		</Box>
	);
};

const INLINE_VALUE_LIMIT = 200;

/** A failing test's error, expanded inline beneath a leaf row or in a failure block. */
const InlineError: FC<{ failure: FailureRecord }> = ({ failure }) => {
	if (failure.error?.message === undefined) return null;
	const first = failure.error.message.split("\n", 1)[0] ?? "";
	const expected = failure.error.expected;
	const received = failure.error.received;
	return (
		<Box flexDirection="column">
			<Text dimColor>
				{"      "}
				{first}
			</Text>
			{expected !== undefined ? (
				<Text dimColor>
					{"      "}
					{"expected: "}
					{expected.slice(0, INLINE_VALUE_LIMIT)}
				</Text>
			) : null}
			{received !== undefined ? (
				<Text dimColor>
					{"      "}
					{"received: "}
					{received.slice(0, INLINE_VALUE_LIMIT)}
				</Text>
			) : null}
		</Box>
	);
};

const failureKey = (f: FailureRecord): string => `failure:${f.modulePath}::${f.suitePath.join("/")}::${f.testName}`;

const testKey = (modulePath: string, t: TestRecord): string =>
	`test:${modulePath}::${t.suitePath.join("/")}::${t.testName}`;

const failurePath = (f: FailureRecord): string => [f.modulePath, ...f.suitePath, f.testName].join(" › ");

/** A failure entry rendered in the Live region. */
const FailureItem: FC<{ failure: FailureRecord }> = ({ failure }) => (
	<Box flexDirection="column">
		<Text>
			{"  "}
			<Text color={failure.timedOut === true ? "#e09a4e" : "red"}>{failure.timedOut === true ? "⧖" : "✗"}</Text>{" "}
			{failurePath(failure)}
			{failure.classification !== null ? <Text color="#c98ae0"> [{failure.classification}]</Text> : null}
		</Text>
		<InlineError failure={failure} />
	</Box>
);

const TotalsLine: FC<{ totals: RenderState["totals"] }> = ({ totals }) => (
	<Text>
		<Text bold>Total:</Text>{" "}
		<CountColumns
			passCount={totals.passCount}
			failCount={totals.failCount}
			skipCount={totals.skipCount}
			timeoutCount={totals.timeoutCount}
		/>
		<Text dimColor> {formatDisplayDuration(totals.durationMs)}</Text>
	</Text>
);

const CoverageItem: FC<{ state: RenderState }> = ({ state }) => {
	if (state.coverage === null) return null;
	const clean = state.coverage.violations.length === 0;
	return (
		<Text>
			<Text bold>Coverage:</Text> <Text color={clean ? "green" : "yellow"}>{clean ? "✓" : "⚠"}</Text>{" "}
			{clean ? "all metrics meet thresholds" : `${state.coverage.violations.length} threshold violation(s)`}
		</Text>
	);
};

const samePath = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
};

/**
 * Compose the Live region content for the given state + shape. Pure;
 * recomputed every render and every clock tick. Renders the ENTIRE
 * run picture — all rows in discovery order, with running rows capped
 * at MAX_LIVE_RUNNING_ROWS and finished rows always shown.
 */
const liveRegion = (
	state: RenderState,
	shape: ReturnType<typeof classifyRunShape>,
	nowMs: number,
	frame: string,
): ReactNode => {
	const groups = groupByProject(state);
	const timedOut = state.phase === "timed-out";
	const finished = state.phase === "finished" || state.phase === "timed-out";
	const ordered = state.moduleOrder.map((p) => state.modules[p]).filter((m): m is ModuleRecord => m !== undefined);

	// `single-test` is Live-only by spec §11.7 — render the row regardless
	// of phase so the spinner resolves in place on finish. The error
	// block, when the lone test fails, is rendered inline beneath the
	// row so the run's final frame is the permanent record.
	if (shape === "single-test") {
		const sole = ordered[0];
		if (sole === undefined || sole.tests.length === 0) {
			return <Text dimColor>discovering tests…</Text>;
		}
		const only = sole.tests[0];
		if (only === undefined) {
			return <Text dimColor>discovering tests…</Text>;
		}
		const failure =
			only.status === "failed" || only.status === "timed-out"
				? state.failures.find(
						(f) =>
							f.testName === only.testName && f.modulePath === sole.modulePath && samePath(f.suitePath, only.suitePath),
					)
				: undefined;
		return (
			<>
				<TestRow test={only} indent={0} />
				{failure !== undefined ? <InlineError failure={failure} /> : null}
			</>
		);
	}

	// Discovery — `RunStarted` arrived but no module has been observed yet.
	if (groups.length === 0) {
		return <Text dimColor>discovering tests…</Text>;
	}

	// Failures section — shared across all non-single-test shapes.
	const failuresSection =
		state.failures.length > 0 ? (
			<Box flexDirection="column">
				{state.failures.map((f) => (
					<FailureItem key={failureKey(f)} failure={f} />
				))}
			</Box>
		) : null;

	// Summary artifacts — coverage, trend, total. Rendered when the run
	// is terminal or when coverage/trend are already available.
	const coverageItem = <CoverageItem state={state} />;
	const trendItem = state.trend !== null ? <TrendLine trend={state.trend} /> : null;
	const totalsItem = (
		<Box flexDirection="column">
			{finished && timedOut ? (
				<Text color="#e09a4e" bold>
					⧖ Run timed out
				</Text>
			) : null}
			<TotalsLine totals={state.totals} />
		</Box>
	);

	if (shape === "workspace") {
		// Render every project row in discovery order. Running rows beyond
		// MAX_LIVE_RUNNING_ROWS are hidden; finished rows always appear.
		const nameWidth = Math.max(0, ...groups.map((g) => g.name.length));
		let runningVisible = 0;
		let runningOverflow = 0;
		const rows: ReactNode[] = [];
		for (const g of groups) {
			const isRunning = g.modules.some(moduleRunning);
			if (isRunning) {
				if (runningVisible < MAX_LIVE_RUNNING_ROWS) {
					runningVisible++;
					const counts = sumCounts(g.modules);
					const summary: ProjectSummary = {
						name: g.name,
						passCount: counts.passCount,
						failCount: counts.failCount,
						skipCount: counts.skipCount,
						durationMs: 0,
					};
					rows.push(
						<ProjectRow
							key={g.name}
							project={summary}
							counts={counts}
							running={true}
							timedOut={timedOut}
							elapsedMs={projectElapsedMs(g, nowMs)}
							frame={frame}
							nameWidth={nameWidth}
							tagCounts={mergeTagCounts(g.modules)}
						/>,
					);
				} else {
					runningOverflow++;
				}
			} else {
				// Finished row — always show, regardless of count.
				const counts = sumCounts(g.modules);
				const summary: ProjectSummary = {
					name: g.name,
					passCount: counts.passCount,
					failCount: counts.failCount,
					skipCount: counts.skipCount,
					durationMs: 0,
				};
				rows.push(
					<ProjectRow
						key={g.name}
						project={summary}
						counts={counts}
						running={false}
						timedOut={timedOut}
						elapsedMs={projectElapsedMs(g, nowMs)}
						frame={frame}
						nameWidth={nameWidth}
						tagCounts={mergeTagCounts(g.modules)}
					/>,
				);
			}
		}
		return (
			<>
				<Text bold>Projects ({groups.length}):</Text>
				{rows}
				{runningOverflow > 0 ? <Text dimColor> … and {runningOverflow} more running</Text> : null}
				{failuresSection}
				{coverageItem}
				{trendItem}
				{totalsItem}
			</>
		);
	}

	if (shape === "single-project") {
		// Render every module row in discovery order. Running rows beyond
		// MAX_LIVE_RUNNING_ROWS are hidden; finished rows always appear.
		const nameWidth = Math.max(0, ...ordered.map((m) => m.modulePath.length));
		let runningVisible = 0;
		let runningOverflow = 0;
		const rows: ReactNode[] = [];
		for (const m of ordered) {
			const isRunning = moduleRunning(m);
			if (isRunning) {
				if (runningVisible < MAX_LIVE_RUNNING_ROWS) {
					runningVisible++;
					rows.push(
						<ModuleStreamRow
							key={m.modulePath}
							module={m}
							nowMs={nowMs}
							frame={frame}
							nameWidth={nameWidth}
							timedOut={timedOut}
						/>,
					);
				} else {
					runningOverflow++;
				}
			} else {
				// Finished row — always show.
				rows.push(
					<ModuleStreamRow
						key={m.modulePath}
						module={m}
						nowMs={nowMs}
						frame={frame}
						nameWidth={nameWidth}
						timedOut={timedOut}
					/>,
				);
			}
		}
		return (
			<>
				<Text bold>Modules ({ordered.length}):</Text>
				{rows}
				{runningOverflow > 0 ? <Text dimColor> … and {runningOverflow} more running</Text> : null}
				{failuresSection}
				{coverageItem}
				{trendItem}
				{totalsItem}
			</>
		);
	}

	// single-file
	const sole = ordered[0];
	if (sole === undefined) {
		return <Text dimColor>discovering tests…</Text>;
	}
	return (
		<>
			<Text>
				<Text bold>{sole.modulePath}</Text>
				<Text dimColor> — {sole.tests.length} tests</Text>
			</Text>
			{sole.tests.map((t) => {
				const failure =
					t.status === "failed" || t.status === "timed-out"
						? state.failures.find(
								(f) =>
									f.testName === t.testName && f.modulePath === sole.modulePath && samePath(f.suitePath, t.suitePath),
							)
						: undefined;
				return (
					<Box key={testKey(sole.modulePath, t)} flexDirection="column">
						<TestRow test={t} indent={2} />
						{failure !== undefined ? <InlineError failure={failure} /> : null}
					</Box>
				);
			})}
			{/* No aggregate Failures section: leaf shapes expand each failure
			    inline under its row above (matching single-test), so rendering
			    failuresSection here would print every failure twice. */}
			{coverageItem}
			{trendItem}
			{totalsItem}
		</>
	);
};

export const StreamApp: FC<StreamAppProps> = ({ state, frameIndex, nowMs }) => {
	const now = nowMs ?? Date.now();
	const frame = spinnerFrame(frameIndex);

	// Compute per-project rollups for the classifier. Cheap.
	const groups = groupByProject(state);
	const projects: ReadonlyArray<ProjectSummary> = groups.map((g) => {
		const c = sumCounts(g.modules);
		return { name: g.name, passCount: c.passCount, failCount: c.failCount, skipCount: c.skipCount, durationMs: 0 };
	});
	const shape = classifyRunShape(state, projects);

	const liveContent = liveRegion(state, shape, now, frame);

	return <Box flexDirection="column">{liveContent}</Box>;
};
