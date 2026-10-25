import type { ConsoleLeaks } from "@vitest-agent/sdk";
import { formatConsoleLeaksNote } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";

describe("formatConsoleLeaksNote", () => {
	it("names the write count, the file count and the fix, then each file with its streams and sample", () => {
		const lines = formatConsoleLeaksNote({
			total: 3,
			byFile: [
				{ file: "src/a.test.ts", stdout: 2, stderr: 0, sample: "debug: starting" },
				{ file: "src/b.test.ts", stdout: 0, stderr: 1 },
			],
		});
		expect(lines).toEqual([
			"Console leaks: passing tests wrote 3 console lines in 2 files; Vitest captured them, so they are noise an agent never sees. Remove the logging or route it through a logger the tests silence.",
			"  src/a.test.ts (2 stdout): debug: starting",
			"  src/b.test.ts (1 stderr)",
		]);
	});

	it("uses the singular for one line in one file", () => {
		const [headline] = formatConsoleLeaksNote({ total: 1, byFile: [{ file: "a.test.ts", stdout: 0, stderr: 1 }] });
		expect(headline).toContain("wrote 1 console line in 1 file;");
	});

	it("caps the file list at three and says how many it left out", () => {
		const byFile = ["a", "b", "c", "d", "e"].map((name) => ({ file: `${name}.test.ts`, stdout: 1, stderr: 1 }));
		const lines = formatConsoleLeaksNote({ total: 10, byFile });
		expect(lines).toHaveLength(5);
		expect(lines[1]).toBe("  a.test.ts (1 stdout, 1 stderr)");
		expect(lines.at(-1)).toBe("  (+2 more files)");
		expect(formatConsoleLeaksNote({ total: 10, byFile, truncated: true }).at(-1)).toBe(
			"  (+2 more files, list truncated)",
		);
	});

	it("reports output from failing tests separately, and prints nothing when that is all there is", () => {
		const leaks: ConsoleLeaks = {
			total: 1,
			byFile: [{ file: "a.test.ts", stdout: 1, stderr: 0 }],
			fromFailingTests: { total: 4, files: 2 },
		};
		expect(formatConsoleLeaksNote(leaks).at(-1)).toBe(
			"  (4 more lines from failing tests in 2 files, not counted as leaks)",
		);
		expect(formatConsoleLeaksNote({ total: 0, byFile: [], fromFailingTests: { total: 4, files: 2 } })).toEqual([]);
	});
});
