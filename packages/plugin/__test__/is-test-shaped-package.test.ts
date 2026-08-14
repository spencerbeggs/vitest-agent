import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTestShapedPackage } from "../src/utils/is-test-shaped-package.js";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "vitest-agent-test-shaped-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

// Re-authored inside the active red phase window (D2 evidence binding).
describe("isTestShapedPackage()", () => {
	it("returns false for a package with neither a __test__/ directory nor src/ test files", async () => {
		// Given: a package with only a non-test src file
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "index.ts"), "export const x = 1;");

		// When/Then
		expect(await isTestShapedPackage(tmpDir)).toBe(false);
	});

	it("returns true for a package with an empty __test__/ directory (naming mismatch case)", async () => {
		// Given: a __test__/ dir exists but holds no files matching the naming convention
		await mkdir(join(tmpDir, "__test__"), { recursive: true });
		await writeFile(join(tmpDir, "__test__", "helper.ts"), "");

		// When/Then: directory existence alone is the signal — this is exactly the
		// "forgot the .test. suffix" mistake the warning exists to catch.
		expect(await isTestShapedPackage(tmpDir)).toBe(true);
	});

	it("returns true for a package with a fully empty __test__/ directory", async () => {
		await mkdir(join(tmpDir, "__test__"), { recursive: true });
		expect(await isTestShapedPackage(tmpDir)).toBe(true);
	});

	it("returns true for a package with co-located src/ test files", async () => {
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "foo.test.ts"), "");
		expect(await isTestShapedPackage(tmpDir)).toBe(true);
	});
});
