import { describe, expect, it } from "vitest";
import { formatScopedCoverageNote } from "../src/utils/format-scoped-coverage-note.js";

describe("formatScopedCoverageNote", () => {
	it("returns the exact informational sentence given tested and total file counts", () => {
		expect(formatScopedCoverageNote(2, 47)).toBe("Coverage thresholds skipped: partial run (2 of 47 test files)");
	});
});
