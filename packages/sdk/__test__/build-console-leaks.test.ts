import type { ConsoleLeakEntry } from "@vitest-agent/sdk";
import { buildConsoleLeaks } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";

const entry = (over: Partial<ConsoleLeakEntry>): ConsoleLeakEntry => ({
	file: "a.test.ts",
	type: "stdout",
	content: "x",
	...over,
});

describe("buildConsoleLeaks", () => {
	it("returns undefined for no entries", () => {
		expect(buildConsoleLeaks([])).toBeUndefined();
	});

	it("buckets by file, splits stdout/stderr, and totals writes", () => {
		const leaks = buildConsoleLeaks([
			entry({ file: "a.test.ts", type: "stdout" }),
			entry({ file: "a.test.ts", type: "stderr" }),
			entry({ file: "b.test.ts", type: "stdout" }),
		]);
		expect(leaks?.total).toBe(3);
		const a = leaks?.byFile.find((f) => f.file === "a.test.ts");
		expect(a).toMatchObject({ stdout: 1, stderr: 1 });
		expect(leaks?.byFile.find((f) => f.file === "b.test.ts")).toMatchObject({ stdout: 1, stderr: 0 });
	});

	it("sorts files by total descending", () => {
		const leaks = buildConsoleLeaks([
			entry({ file: "quiet.test.ts" }),
			entry({ file: "loud.test.ts" }),
			entry({ file: "loud.test.ts" }),
			entry({ file: "loud.test.ts" }),
		]);
		expect(leaks?.byFile[0].file).toBe("loud.test.ts");
	});

	it("collects attributable test names and omits tests when none", () => {
		const leaks = buildConsoleLeaks([entry({ file: "a.test.ts", test: "leaks here" }), entry({ file: "b.test.ts" })]);
		expect(leaks?.byFile.find((f) => f.file === "a.test.ts")?.tests).toEqual(["leaks here"]);
		expect(leaks?.byFile.find((f) => f.file === "b.test.ts")?.tests).toBeUndefined();
	});

	it("captures the first sample per file as one trimmed, truncated line", () => {
		const leaks = buildConsoleLeaks([entry({ file: "a.test.ts", content: `  ${"D".repeat(200)}\nsecond line` })]);
		const sample = leaks?.byFile[0].sample ?? "";
		expect(sample.endsWith("…")).toBe(true);
		expect(sample).not.toContain("second line");
		expect(sample.length).toBe(161); // 160 chars + ellipsis
	});

	it("caps to 25 files and sets truncated", () => {
		const entries = Array.from({ length: 30 }, (_, i) => entry({ file: `f${i}.test.ts` }));
		const leaks = buildConsoleLeaks(entries);
		expect(leaks?.total).toBe(30);
		expect(leaks?.byFile.length).toBe(25);
		expect(leaks?.truncated).toBe(true);
	});

	it("caps test names per file to 10", () => {
		const entries = Array.from({ length: 12 }, (_, i) => entry({ file: "a.test.ts", test: `t${i}` }));
		expect(buildConsoleLeaks(entries)?.byFile[0].tests?.length).toBe(10);
	});
});
