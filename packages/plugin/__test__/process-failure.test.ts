import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MemoryFileSystem } from "@effected/memfs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processFailure } from "../src/utils/process-failure.js";
import type { MemfsSync } from "./utils/memfs-sync.js";
import { makeMemfsSync } from "./utils/memfs-sync.js";

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

// A real source file with a nameable function whose loc range contains the
// cited line. Line 3 sits inside `myNamedFunction` (declared on line 2), so
// findFunctionBoundary returns { line: 2, name: "myNamedFunction" }.
const FIXTURE_SOURCE = [
	"// fixture source",
	"export const myNamedFunction = (x: number): number => {",
	"\tconst y = x + 1;",
	"\treturn y * 2;",
	"};",
	"",
].join("\n");

const failureAt = (file: string, line: number) => ({
	name: "AssertionError",
	message: "expect(2).toBe(3)",
	stacks: [{ method: "wrapper", file, line, column: 9 }],
});

describe("processFailure - findFunctionBoundary hit (lines 106-107)", () => {
	// The source is read through the injected `readSource` port over an
	// `@effected/memfs` volume; its `readFile` throws a node-style ENOENT on a
	// miss, which is exactly what readSourceSafe must swallow.
	let vol: MemfsSync;
	let sourcePath: string;

	beforeAll(() => {
		vol = makeMemfsSync({ "fixture.ts": FIXTURE_SOURCE });
		sourcePath = vol.at("fixture.ts");
	});

	it("populates functionBoundaryLine and uses function name in signature when boundary resolves", () => {
		const result = processFailure(failureAt(sourcePath, 3), { readSource: vol.fs.readFile });

		expect(result.frames).toHaveLength(1);
		const frame = result.frames[0];
		// Lines 106-107 set topBoundaryLine = 2 and topFunctionName = "myNamedFunction".
		// The reporter's frame-building stage then attaches functionBoundaryLine
		// to the top frame.
		expect(frame.functionBoundaryLine).toBe(2);
		expect(frame.filePath).toBe(sourcePath);
		expect(frame.line).toBe(3);

		// The signature hash is non-null because a top non-framework frame exists
		// AND the boundary resolved.
		expect(result.signatureHash).not.toBeNull();
		expect(result.signatureHash).toMatch(/^[0-9a-f]{16}$/);

		// And the boundary actually feeds the signature: the same failure with an
		// unreadable source hashes differently (raw-line bucket instead of fb:).
		const { sync: denied } = vol.withFaults({
			sync: {
				readFile: (path) => {
					throw MemoryFileSystem.errno("EACCES", "open", path);
				},
			},
		});
		const unreadable = processFailure(failureAt(sourcePath, 3), { readSource: denied.readFile });
		expect(unreadable.signatureHash).not.toBe(result.signatureHash);
	});

	it("falls back to raw-line bucket when source file is unreadable", () => {
		// Pointing at a file absent from the volume makes readSource throw
		// (ENOENT), so readSourceSafe returns null and findFunctionBoundary is
		// short-circuited: boundary stays null and the signature falls back to
		// the raw-line bucket.
		const missing = vol.at("does-not-exist.ts");
		expect(vol.fs.exists(missing)).toBe(false);
		const result = processFailure(failureAt(missing, 7), { readSource: vol.fs.readFile });

		expect(result.frames).toHaveLength(1);
		// No boundary -> no functionBoundaryLine attached to the top frame.
		expect(result.frames[0].functionBoundaryLine).toBeUndefined();
		// Signature still produced (top non-framework frame existed); just keyed
		// off the raw-line bucket coordinate instead of fb:.
		expect(result.signatureHash).not.toBeNull();
		expect(result.signatureHash).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("processFailure - default node:fs readSource (real disk smoke)", () => {
	let tmpDir: string;
	let sourcePath: string;

	beforeAll(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "process-failure-test-"));
		sourcePath = path.join(tmpDir, "fixture.ts");
		writeFileSync(sourcePath, FIXTURE_SOURCE);
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reads the top frame's source from disk when no readSource is injected", () => {
		const result = processFailure(failureAt(sourcePath, 3));

		expect(result.frames[0].functionBoundaryLine).toBe(2);
		expect(result.signatureHash).toMatch(/^[0-9a-f]{16}$/);
	});
});
