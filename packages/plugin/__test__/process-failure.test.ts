import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processFailure } from "../src/utils/process-failure.js";

describe("processFailure - stacks array branch (line 81)", () => {
	it("uses defaults when frame fields are all missing", () => {
		// Frame with no method/file/line/column — exercises ?? null, ?? "<unknown>",
		// ?? 0, ?? 0 defaults on the stacks-array branch.
		const result = processFailure({
			name: "AssertionError",
			message: "expect(received).toBe(expected)",
			stacks: [{}],
		});

		expect(result.frames).toHaveLength(1);
		const frame = result.frames[0];
		expect(frame.method).toBeNull();
		expect(frame.filePath).toBe("<unknown>");
		expect(frame.line).toBe(0);
		expect(frame.col).toBe(0);
		// The frame is <unknown>, so no top non-framework frame is selected.
		expect(result.signatureHash).toBeNull();
	});

	it("uses provided values when frame fields are present and parses optional fields per frame", () => {
		// Mix: first frame missing method (defaults to null), second frame fully
		// populated. Both originate from `stacks` so both go through the .map(...)
		// arm on line 81.
		const result = processFailure({
			name: "AssertionError",
			message: "expect(received).toBe(expected)",
			stacks: [
				// Missing `method`, only file/line/column populated. Exercises the
				// `f.method ?? null` default while other fields take provided values.
				{ file: "/some/non/existent/path/foo.ts", line: 5, column: 3 },
				// Fully populated frame.
				{
					method: "namedFn",
					file: "/some/other/non/existent/path/bar.ts",
					line: 10,
					column: 2,
				},
			],
		});

		expect(result.frames).toHaveLength(2);
		expect(result.frames[0].method).toBeNull();
		expect(result.frames[0].filePath).toBe("/some/non/existent/path/foo.ts");
		expect(result.frames[0].line).toBe(5);
		expect(result.frames[0].col).toBe(3);
		expect(result.frames[1].method).toBe("namedFn");
		expect(result.frames[1].filePath).toBe("/some/other/non/existent/path/bar.ts");
		expect(result.frames[1].line).toBe(10);
		expect(result.frames[1].col).toBe(2);
		// Both frames are sourceMapped (came from `stacks`), so the live layer
		// will populate stack_frames.source_mapped_line.
		expect(result.frames[0].sourceMappedLine).toBe(5);
		expect(result.frames[1].sourceMappedLine).toBe(10);
	});
});

describe("processFailure - findFunctionBoundary hit (lines 106-107)", () => {
	let tmpDir: string;
	let sourcePath: string;

	beforeAll(() => {
		// Create a real source file the readSourceSafe path can read, with a
		// nameable function whose loc range will contain the cited line. This
		// exercises the `if (boundary !== null)` block where topBoundaryLine and
		// topFunctionName are assigned from the AST walk result.
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "process-failure-test-"));
		sourcePath = path.join(tmpDir, "fixture.ts");
		writeFileSync(
			sourcePath,
			[
				"// fixture source",
				"export const myNamedFunction = (x: number): number => {",
				"\tconst y = x + 1;",
				"\treturn y * 2;",
				"};",
				"",
			].join("\n"),
		);
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("populates functionBoundaryLine and uses function name in signature when boundary resolves", () => {
		// Line 3 of the fixture is inside `myNamedFunction` (declared on line 2).
		// findFunctionBoundary should return { line: 2, name: "myNamedFunction" }.
		const result = processFailure({
			name: "AssertionError",
			message: "expect(2).toBe(3)",
			stacks: [
				{
					method: "wrapper",
					file: sourcePath,
					line: 3,
					column: 9,
				},
			],
		});

		expect(result.frames).toHaveLength(1);
		const frame = result.frames[0];
		// Lines 106-107 set topBoundaryLine = 2 and topFunctionName = "myNamedFunction".
		// The reporter's frame-building stage then attaches functionBoundaryLine
		// to the top frame.
		expect(frame.functionBoundaryLine).toBe(2);
		expect(frame.filePath).toBe(sourcePath);
		expect(frame.line).toBe(3);

		// The signature hash is non-null because a top non-framework frame exists
		// AND the boundary resolved. We can't easily assert the exact hash without
		// hardcoding sha256 output, but we can check it was produced (i.e. line
		// 132's computeFailureSignature was reached with a real boundary, not the
		// raw-line fallback).
		expect(result.signatureHash).not.toBeNull();
		expect(typeof result.signatureHash).toBe("string");
		expect(result.signatureHash).toMatch(/^[0-9a-f]{16}$/);
	});

	it("falls back to raw-line bucket when source file is unreadable", () => {
		// Pointing at a non-existent file makes readSourceSafe return null, which
		// short-circuits findFunctionBoundary. The branch on line 104 takes the
		// `null` arm: boundary stays null, topBoundaryLine and topFunctionName
		// stay null, and the signature falls back to the raw-line bucket.
		const result = processFailure({
			name: "AssertionError",
			message: "expect(2).toBe(3)",
			stacks: [
				{
					method: "wrapper",
					file: path.join(tmpDir, "does-not-exist.ts"),
					line: 7,
					column: 1,
				},
			],
		});

		expect(result.frames).toHaveLength(1);
		// No boundary -> no functionBoundaryLine attached to the top frame.
		expect(result.frames[0].functionBoundaryLine).toBeUndefined();
		// Signature still produced (top non-framework frame existed); just keyed
		// off the raw-line bucket coordinate instead of fb:.
		expect(result.signatureHash).not.toBeNull();
		expect(result.signatureHash).toMatch(/^[0-9a-f]{16}$/);
	});
});
