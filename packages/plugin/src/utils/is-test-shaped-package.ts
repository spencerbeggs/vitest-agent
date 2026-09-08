import { join } from "node:path";
import { BATS_FILE_GLOB_SUFFIX, SRC_DIR, TEST_DIR, TEST_FILE_GLOB_SUFFIX } from "@vitest-agent/sdk";
import { findTestFiles } from "./find-test-files.js";
import type { WalkerFileSystem } from "./walker-fs.js";
import { nodeWalkerFs } from "./walker-fs.js";

/**
 * True when `pkgPath` looks like it was meant to hold tests, yet neither a
 * discoverable Vitest test file nor a Bats test file was found anywhere
 * under it — the condition `discoverProjects`'s declined-package warning
 * (issue #229) exists to catch.
 *
 * We only want to surface a warning when NO vitest test and NO bats test
 * are found. Concretely, in order:
 *
 * 1. A Vitest-convention test file under `src/**` or `__test__/**`
 *    (`TEST_FILE_GLOB_SUFFIX`) → not test-shaped (false, no warning). The
 *    package has real, discoverable tests.
 * 2. A `.bats` file anywhere under the package (`BATS_FILE_GLOB_SUFFIX`,
 *    searched recursively — a nested `__test__/foo/bar.bats` counts) → not
 *    test-shaped (false, no warning). Bats tests are run by `bats`, not
 *    Vitest (`bats --recursive`, or the `test:bats` package script); a
 *    `__test__/` directory holding only `.bats` files (plus fixtures) is a
 *    fully supported, intentional layout — see `@effected/claude-code-plugin`'s
 *    `plugins/claude-code/__test__/` for the real case this fixes (issue
 *    #360-adjacent).
 * 3. Otherwise, a `__test__/` directory existing at all — regardless of what
 *    it contains — IS test-shaped (true, warn). This is deliberately
 *    existence-only, not content-matching: the failure mode this predicate
 *    exists to catch (issue #229) IS a `__test__/` directory whose files
 *    match neither convention (wrong suffix, wrong extension, typo, or
 *    nothing at all — an empty directory). `DefaultDiscoverStrategy
 *    .buildProject` already declined those packages by finding zero
 *    matching Vitest files; step 1 above already declined them by finding
 *    zero Bats files either; requiring a content match here too would make
 *    the predicate blind to exactly the case it needs to catch.
 *
 * Reuses `SRC_DIR` / `TEST_DIR` / `TEST_FILE_GLOB_SUFFIX` /
 * `BATS_FILE_GLOB_SUFFIX` from `@vitest-agent/sdk`'s `utils/test-location.ts`
 * — the single source of truth for the test-layout rule — and the existing
 * `findTestFiles` walker, rather than re-deriving the shape independently.
 * @internal
 */
export async function isTestShapedPackage(pkgPath: string, fs: WalkerFileSystem = nodeWalkerFs): Promise<boolean> {
	const testFiles = await findTestFiles(
		pkgPath,
		[
			`${SRC_DIR}/**/${TEST_FILE_GLOB_SUFFIX}`,
			`${TEST_DIR}/**/${TEST_FILE_GLOB_SUFFIX}`,
			`**/${BATS_FILE_GLOB_SUFFIX}`,
		],
		fs,
	);
	if (testFiles.length > 0) return false;
	return (await fs.statEntry(join(pkgPath, TEST_DIR)))?.isDirectory === true;
}
