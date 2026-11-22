import { describe, expect, it } from "vitest";
import { MAX_TRACE_STEPS, normalizeTraceSteps } from "../src/utils/trace-steps.js";

const artifact = (data: unknown, type = "internal:browserTrace") => ({ type, data });

describe("normalizeTraceSteps", () => {
	it("should strip the vitest: prefix and keep status, start, duration and location", () => {
		const steps = normalizeTraceSteps(
			[
				artifact({
					retry: 0,
					repeats: 0,
					entries: [
						{
							name: "vitest:expect.toBe",
							kind: "expect",
							status: "fail",
							startTime: 12.4,
							duration: 3,
							location: { file: "/repo/src/a.test.ts", line: 4, column: 7 },
						},
					],
				}),
			],
			{ retryIndex: 0, repeatIndex: 0 },
			"/repo",
		);
		expect(steps).toEqual([
			{
				name: "expect.toBe",
				status: "fail",
				startTime: 12.4,
				duration: 3,
				depth: 0,
				location: { file: "src/a.test.ts", line: 4, column: 7 },
			},
		]);
	});

	it("should merge range start and end entries into one step with nesting depth and duration", () => {
		const steps = normalizeTraceSteps(
			[
				artifact({
					retry: 0,
					repeats: 0,
					entries: [
						{ name: "outer", kind: "action", startTime: 0, range: { id: "a", phase: "start" } },
						{ name: "inner", kind: "action", startTime: 5 },
						{ name: "outer", kind: "action", startTime: 20, status: "fail", range: { id: "a", phase: "end" } },
					],
				}),
			],
			{ retryIndex: 0, repeatIndex: 0 },
		);
		expect(steps).toEqual([
			{ name: "outer", status: "fail", startTime: 0, duration: 20, depth: 0 },
			{ name: "inner", startTime: 5, depth: 1 },
		]);
	});

	it("should drop onAfterRetryTask and keep only the last ten steps", () => {
		const entries = Array.from({ length: 14 }, (_, i) => ({ name: `s${i}`, kind: "mark", startTime: i }));
		entries.push({ name: "vitest:onAfterRetryTask", kind: "lifecycle", startTime: 99 });
		const steps = normalizeTraceSteps([artifact({ retry: 0, repeats: 0, entries })], { retryIndex: 0, repeatIndex: 0 });
		expect(MAX_TRACE_STEPS).toBe(10);
		expect(steps.map((s) => s.name)).toEqual(Array.from({ length: 10 }, (_, i) => `s${i + 4}`));
	});

	it("should select the requested attempt and merge artifacts of the same attempt", () => {
		const steps = normalizeTraceSteps(
			[
				artifact({ retry: 0, repeats: 0, entries: [{ name: "first", kind: "mark", startTime: 1 }] }),
				artifact({ retry: 1, repeats: 0, entries: [{ name: "second", kind: "mark", startTime: 1 }] }),
				artifact({ retry: 1, repeats: 0, entries: [{ name: "third", kind: "mark", startTime: 2 }] }),
			],
			{ retryIndex: 1, repeatIndex: 0 },
		);
		expect(steps.map((s) => s.name)).toEqual(["second", "third"]);
	});

	it("should ignore other artifact types and survive malformed data", () => {
		const hostile = {
			type: "internal:browserTrace",
			get data(): unknown {
				throw new Error("boom");
			},
		};
		const steps = normalizeTraceSteps(
			[
				artifact({ entries: "nope" }),
				artifact(null),
				hostile,
				artifact({ retry: 0, repeats: 0, entries: [{ name: "ok", startTime: 1 }, 7, { startTime: 2 }] }, "other"),
				artifact({
					retry: 0,
					repeats: 0,
					entries: [{ name: "kept", kind: "mark", startTime: 1 }, null, { name: 5 }, { name: "nostart" }],
				}),
			],
			{ retryIndex: 0, repeatIndex: 0 },
		);
		expect(steps.map((s) => s.name)).toEqual(["kept"]);
	});

	it("should fall back to the last recorded attempt when none is requested", () => {
		const steps = normalizeTraceSteps([
			artifact({ retry: 0, repeats: 0, entries: [{ name: "a", kind: "mark", startTime: 1 }] }),
			artifact({ retry: 2, repeats: 0, entries: [{ name: "b", kind: "mark", startTime: 1 }] }),
		]);
		expect(steps.map((s) => s.name)).toEqual(["b"]);
	});
});
