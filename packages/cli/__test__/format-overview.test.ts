import { describe, expect, it } from "vitest";
import type { CacheManifest, TestFileEntry } from "vitest-agent-sdk";
import { formatOverview } from "../src/lib/format-overview.js";

function makeManifest(projects: CacheManifest["projects"] = []): CacheManifest {
	return {
		updatedAt: "2026-03-20T00:00:00.000Z",
		cacheDir: ".vitest-agent",
		projects,
	};
}

describe("formatOverview", () => {
	it("renders test file count", () => {
		const testFiles: TestFileEntry[] = [
			{ testFile: "src/utils.test.ts", sourceFiles: [] },
			{ testFile: "src/coverage.test.ts", sourceFiles: [] },
		];

		const result = formatOverview(null, testFiles, null);
		expect(result).toContain("## Test Landscape");
		expect(result).toContain("**Test files:** 2");
	});

	it("renders package manager when provided", () => {
		const result = formatOverview(null, [], "pnpm");
		expect(result).toContain("**Package manager:** pnpm");
	});

	it("omits package manager when null", () => {
		const result = formatOverview(null, [], null);
		expect(result).not.toContain("**Package manager:**");
	});

	it("renders project info from manifest", () => {
		const manifest = makeManifest([
			{
				project: "core",
				reportFile: "reports/core.json",
				lastRun: "2026-03-20T00:00:00.000Z",
				lastResult: "passed",
			},
			{
				project: "utils",
				reportFile: "reports/utils.json",
				lastRun: null,
				lastResult: null,
			},
		]);

		const result = formatOverview(manifest, [], "npm");
		expect(result).toContain("**Projects:** 2");
		expect(result).toContain("### core");
		expect(result).toContain("- **Last result:** passed");
		expect(result).toContain("### utils");
		expect(result).toContain("- **Last result:** unknown");
	});

	it("renders file map when test files have source mappings", () => {
		const testFiles: TestFileEntry[] = [
			{
				testFile: "src/utils.test.ts",
				sourceFiles: ["src/utils.ts"],
			},
			{
				testFile: "src/coverage.test.ts",
				sourceFiles: ["src/coverage.ts"],
			},
		];

		const result = formatOverview(null, testFiles, null);
		expect(result).toContain("### File Map");
		expect(result).toContain("| Source | Tests |");
		expect(result).toContain("| src/utils.ts | src/utils.test.ts |");
		expect(result).toContain("| src/coverage.ts | src/coverage.test.ts |");
	});

	it("groups multiple tests per source file", () => {
		const testFiles: TestFileEntry[] = [
			{
				testFile: "src/utils.test.ts",
				sourceFiles: ["src/utils.ts"],
			},
			{
				testFile: "src/utils.integration.test.ts",
				sourceFiles: ["src/utils.ts"],
			},
		];

		const result = formatOverview(null, testFiles, null);
		expect(result).toContain("| src/utils.ts | src/utils.test.ts, src/utils.integration.test.ts |");
	});

	it("omits file map when no test files have source mappings", () => {
		const testFiles: TestFileEntry[] = [{ testFile: "src/utils.test.ts", sourceFiles: [] }];

		const result = formatOverview(null, testFiles, null);
		expect(result).not.toContain("### File Map");
	});

	it("omits project info when manifest is null", () => {
		const result = formatOverview(null, [], null);
		expect(result).not.toContain("**Projects:**");
	});
});
