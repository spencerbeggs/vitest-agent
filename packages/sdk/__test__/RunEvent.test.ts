import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { RunEvent } from "../src/schemas/RunEvent.js";

const decode = Schema.decodeUnknownSync(RunEvent);

describe("RunEvent — stream-mode-states additions", () => {
	it("accepts a TestFinished carrying timedOut", () => {
		const e = decode({
			_tag: "TestFinished",
			modulePath: "a.test.ts",
			testName: "t",
			suitePath: [],
			status: "failed",
			durationMs: 5,
			timedOut: true,
		});
		expect(e._tag).toBe("TestFinished");
	});

	it("accepts a ModuleFinished carrying timeoutCount", () => {
		const e = decode({
			_tag: "ModuleFinished",
			modulePath: "a.test.ts",
			passCount: 1,
			failCount: 0,
			skipCount: 0,
			durationMs: 5,
			timeoutCount: 2,
		});
		expect(e._tag).toBe("ModuleFinished");
	});

	it("accepts a RunFinished carrying timeoutCount", () => {
		const e = decode({
			_tag: "RunFinished",
			runId: "r",
			finishedAt: "T1",
			passCount: 1,
			failCount: 0,
			skipCount: 0,
			durationMs: 5,
			timeoutCount: 1,
		});
		expect(e._tag).toBe("RunFinished");
	});

	it("decodes a TrendComputed event", () => {
		const e = decode({ _tag: "TrendComputed", direction: "regressing", runCount: 5 });
		expect(e).toMatchObject({ _tag: "TrendComputed", direction: "regressing", runCount: 5 });
	});

	it("accepts a ModuleFinished carrying tagCounts", () => {
		const e = decode({
			_tag: "ModuleFinished",
			modulePath: "a.test.ts",
			passCount: 961,
			failCount: 0,
			skipCount: 0,
			durationMs: 5,
			tagCounts: { int: 6, unit: 955 },
		});
		expect(e._tag).toBe("ModuleFinished");
	});
});
