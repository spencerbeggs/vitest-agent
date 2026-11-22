// Normalise Vitest 5.1's `internal:browserTrace` artifacts (the
// `experimental.traceTimeline` steps of a failed attempt) into a small, stable
// step list. The shape is read from `@vitest/utils/trace` (`BrowserTraceData`,
// `groupTraceAttempts`) and Vitest's own renderer
// (`node/reporters/renderers/trace-timeline.ts`): group artifacts by
// `${repeats}:${retry}`, merge each range's start and end entry into one step
// (duration = end.startTime - start.startTime), drop `onAfterRetryTask`, keep
// the last ten. `@vitest/utils` is deliberately not imported: the artifact
// `data` is typed `unknown` and experimental, so every read here is guarded and
// a malformed artifact yields no steps instead of an error.

import type { TraceStep } from "../schemas/Common.js";
import { relativePosix } from "./posix-path.js";

/** Vitest's own renderer shows the last ten steps of an attempt. @public */
export const MAX_TRACE_STEPS = 10;

const TRACE_ARTIFACT_TYPE = "internal:browserTrace";
const RETRY_TASK_STEP = "vitest:onAfterRetryTask";
const NAME_PREFIX = "vitest:";

const read = (obj: unknown, key: string): unknown => {
	try {
		return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
	} catch {
		return undefined;
	}
};

const finite = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

interface RawStep {
	readonly name: string;
	readonly startTime: number;
	readonly duration?: number;
	readonly status?: "pass" | "fail";
	readonly locator?: string;
	readonly location?: { file: string; line: number; column: number };
	readonly range?: { id: string; phase: "start" | "end" };
}

const parseEntry = (entry: unknown): RawStep | undefined => {
	const name = read(entry, "name");
	const startTime = finite(read(entry, "startTime"));
	if (typeof name !== "string" || startTime === undefined) return undefined;
	const status = read(entry, "status");
	const duration = finite(read(entry, "duration"));
	const locator = read(read(entry, "element"), "locator");
	const loc = read(entry, "location");
	const file = read(loc, "file");
	const line = finite(read(loc, "line"));
	const column = finite(read(loc, "column"));
	const rangeId = read(read(entry, "range"), "id");
	const phase = read(read(entry, "range"), "phase");
	return {
		name,
		startTime,
		...(duration !== undefined && { duration }),
		...((status === "pass" || status === "fail") && { status }),
		...(typeof locator === "string" && locator !== "" && { locator }),
		...(typeof file === "string" && line !== undefined && column !== undefined && { location: { file, line, column } }),
		...(typeof rangeId === "string" && (phase === "start" || phase === "end") && { range: { id: rangeId, phase } }),
	};
};

/** Merge range start/end entries, mirroring `normalizeTraceEntries` in `@vitest/utils/trace`. */
const mergeRanges = (entries: ReadonlyArray<RawStep>): Array<{ step: RawStep; depth: number; duration?: number }> => {
	const merged: Array<{ step: RawStep; depth: number; duration?: number }> = [];
	const starts = new Map<string, number>();
	let depth = 0;
	for (const step of entries) {
		const range = step.range;
		if (range === undefined) {
			merged.push({ step, depth });
			continue;
		}
		if (range.phase === "start") {
			starts.set(range.id, merged.length);
			merged.push({ step, depth });
			depth++;
			continue;
		}
		const index = starts.get(range.id);
		if (index === undefined) {
			merged.push({ step, depth: 0 });
			continue;
		}
		const start = merged[index];
		if (start === undefined) continue;
		merged[index] = {
			depth: start.depth,
			duration: step.startTime - start.step.startTime,
			step: {
				...start.step,
				name: step.name,
				startTime: start.step.startTime,
				...(step.status !== undefined && { status: step.status }),
				...(step.locator !== undefined && { locator: step.locator }),
				...(step.location !== undefined && { location: step.location }),
			},
		};
		depth = Math.max(0, depth - 1);
	}
	return merged;
};

/**
 * Normalise the trace-timeline steps of one attempt out of a test's artifacts.
 *
 * @param artifacts - the raw `TestCase.artifacts()` list; anything that is not
 * an `internal:browserTrace` artifact is ignored
 * @param attempt - the attempt to read (the failed one); defaults to the last
 * attempt a trace was recorded for
 * @param root - project root; absolute step locations under it are made relative
 * @returns up to {@link MAX_TRACE_STEPS} steps, oldest first, `vitest:` prefix
 * removed and `onAfterRetryTask` dropped; empty when nothing usable is found
 * @public
 */
export const normalizeTraceSteps = (
	artifacts: ReadonlyArray<unknown>,
	attempt?: { readonly retryIndex: number; readonly repeatIndex: number },
	root?: string,
): ReadonlyArray<TraceStep> => {
	const groups = new Map<string, Array<RawStep>>();
	for (const artifact of artifacts) {
		if (read(artifact, "type") !== TRACE_ARTIFACT_TYPE) continue;
		const data = read(artifact, "data");
		const retry = finite(read(data, "retry"));
		const repeats = finite(read(data, "repeats"));
		const entries = read(data, "entries");
		if (retry === undefined || repeats === undefined || !Array.isArray(entries)) continue;
		const key = `${repeats}:${retry}`;
		const group = groups.get(key) ?? [];
		groups.set(key, group);
		for (const entry of entries) {
			const parsed = parseEntry(entry);
			if (parsed !== undefined) group.push(parsed);
		}
	}
	const keys = [...groups.keys()];
	const key = attempt === undefined ? keys[keys.length - 1] : `${attempt.repeatIndex}:${attempt.retryIndex}`;
	const group = key === undefined ? undefined : groups.get(key);
	if (group === undefined) return [];
	return mergeRanges(group)
		.filter(({ step }) => step.name !== RETRY_TASK_STEP)
		.slice(-MAX_TRACE_STEPS)
		.map(({ step, depth, duration: ranged }): TraceStep => {
			const location = step.location;
			const duration = ranged ?? step.duration;
			return {
				name: step.name.startsWith(NAME_PREFIX) ? step.name.slice(NAME_PREFIX.length) : step.name,
				...(step.status !== undefined && { status: step.status }),
				startTime: step.startTime,
				...(duration !== undefined && { duration }),
				depth,
				...(step.locator !== undefined && { locator: step.locator }),
				...(location !== undefined && {
					location: {
						file: root === undefined ? location.file : relativePosix(root, location.file),
						line: location.line,
						column: location.column,
					},
				}),
			};
		});
};
