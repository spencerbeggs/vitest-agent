import { stat } from "node:fs/promises";
import { join } from "node:path";
import { SRC_DIR, TEST_DIR, TEST_FILE_GLOB_SUFFIX } from "@vitest-agent/sdk";
import { findTestFiles } from "./find-test-files.js";

async function isDirectory(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * True when `pkgPath` looks like it was meant to hold tests: a `__test__/`
 * directory exists at the package root (regardless of what's inside it), or
 * `src/` contains at least one file matching the discoverable test-file
 * naming convention (`TEST_FILE_GLOB_SUFFIX`).
 *
 * Reuses `SRC_DIR` / `TEST_DIR` / `TEST_FILE_GLOB_SUFFIX` from
 * `@vitest-agent/sdk`'s `utils/test-location.ts` — the single source of
 * truth for the test-layout rule — and the existing `findTestFiles` walker,
 * rather than re-deriving the shape independently.
 *
 * A `__test__/` directory counts on existence alone, not on matching file
 * content: the failure mode this predicate exists to catch (issue #229) IS a
 * `__test__/` directory whose files don't match the naming convention (wrong
 * suffix, wrong extension, typo) — `DefaultDiscoverStrategy.buildProject`
 * already declined those packages by finding zero matching files, so
 * requiring a match here would make the predicate blind to exactly the case
 * it needs to catch.
 * @internal
 */
export async function isTestShapedPackage(pkgPath: string): Promise<boolean> {
	if (await isDirectory(join(pkgPath, TEST_DIR))) return true;
	const srcTestFiles = await findTestFiles(pkgPath, [`${SRC_DIR}/**/${TEST_FILE_GLOB_SUFFIX}`]);
	return srcTestFiles.length > 0;
}
