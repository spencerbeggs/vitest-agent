import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { describe, expect, it } from "vitest";
import { isTestShapedPackage } from "../src/utils/is-test-shaped-package.js";
import { seedMemfsWalker } from "./utils/memfs-walker.js";

// Every case runs against a seeded `@effected/memfs` volume through the
// `WalkerFileSystem` port — no temporary directory, nothing on disk.
// `isTestShapedPackage` keeps no cache, so a fixed root is safe to share.
const PKG = "/pkg";

/** Seeds `files` (relative to the package root) and asks whether it is test-shaped. */
const shapedIn = (files: Readonly<Record<string, MemoryFileSystemSeedEntry>>): Promise<boolean> =>
	isTestShapedPackage(PKG, seedMemfsWalker(PKG, files));

// Re-authored inside the active red phase window (D2 evidence binding).
describe("isTestShapedPackage()", () => {
	it("returns false for a package with neither a __test__/ directory nor src/ test files", async () => {
		// Given: a package with only a non-test src file
		// When/Then
		expect(await shapedIn({ "src/index.ts": "export const x = 1;" })).toBe(false);
	});

	it("returns true for a package with an empty __test__/ directory (naming mismatch case)", async () => {
		// Given: a __test__/ dir exists but holds no files matching the Vitest OR
		// bats naming convention
		// When/Then: neither a Vitest test nor a bats test was found, so
		// directory existence alone is the signal — this is exactly the
		// "forgot the .test. suffix" mistake the warning exists to catch.
		expect(await shapedIn({ "__test__/helper.ts": "" })).toBe(true);
	});

	it("returns true for a package with a fully empty __test__/ directory", async () => {
		expect(await shapedIn({ __test__: MemoryFileSystem.directory() })).toBe(true);
	});

	it("returns false for a package with co-located src/ test files (a real Vitest test was found)", async () => {
		expect(await shapedIn({ "src/foo.test.ts": "" })).toBe(false);
	});

	it("returns false for a __test__/ directory containing only .bats files (bats runs them, not Vitest)", async () => {
		// Given: the real layout this fixes — .bats suites plus their fixtures
		expect(
			await shapedIn({
				"__test__/agent-skill-registration.bats": "#!/usr/bin/env bats\n",
				"__test__/session-start-orientation.bats": "#!/usr/bin/env bats\n",
				"__test__/fixtures/some-fixture.json": "{}",
			}),
		).toBe(false);
	});

	it("returns false for a nested .bats file under __test__/ (recursive bats search)", async () => {
		expect(await shapedIn({ "__test__/sub/nested.bats": "#!/usr/bin/env bats\n" })).toBe(false);
	});
});
