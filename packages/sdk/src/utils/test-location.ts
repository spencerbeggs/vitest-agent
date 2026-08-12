import { basename, join, relative, sep } from "node:path";

/** Directory holding source files whose tests may be co-located. @public */
export const SRC_DIR = "src";

/** Canonical test directory name. @public */
export const TEST_DIR = "__test__";

/** Support directories under `__test__/` that are never collected. @public */
export const TEST_HELPER_DIRS = ["fixtures", "snapshots", "utils"] as const;

/** Glob suffix matching every discoverable test file. @public */
export const TEST_FILE_GLOB_SUFFIX = "*.{test,spec}.{ts,tsx,js,jsx}";

/**
 * Outcome of classifying a path against the test-layout rule.
 *
 * - `valid` — discoverable by Vitest.
 * - `excluded` — deliberately not discovered, and correct where it is.
 * - `invalid` — not a legal test location.
 * @public
 */
export type TestPathVerdict = "valid" | "excluded" | "invalid";

/** Result of {@link classifyTestPath}. @public */
export interface TestPathClassification {
	readonly verdict: TestPathVerdict;
	readonly workspace: string | null;
	readonly suggestedPath: string | null;
}

/** Minimal workspace shape {@link classifyTestPath} needs to attribute a path. @public */
export interface WorkspaceLike {
	readonly name: string;
	readonly path: string;
}

/** True when `child` is `parent` or sits beneath it on a segment boundary. */
function contains(parent: string, child: string): boolean {
	return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

/**
 * Classifies `filePath` against the test-layout rule: a test file is
 * discoverable only at `<workspace>/src/**` or `<workspace>/__test__/**`,
 * excluding the helper directories under `__test__/`.
 *
 * Returns `null` when no supplied workspace contains the path. That is not a
 * verdict — it means the rule has nothing to say, and callers must fail open
 * rather than treat it as invalid.
 * @public
 */
export function classifyTestPath(
	workspaces: ReadonlyArray<WorkspaceLike>,
	filePath: string,
): TestPathClassification | null {
	let owner: WorkspaceLike | null = null;
	for (const ws of workspaces) {
		if (!contains(ws.path, filePath)) continue;
		if (owner === null || ws.path.length > owner.path.length) owner = ws;
	}
	if (owner === null) return null;

	const segments = relative(owner.path, filePath).split(sep);
	const [head] = segments;

	if (head === SRC_DIR) {
		return { verdict: "valid", workspace: owner.name, suggestedPath: null };
	}

	if (head === TEST_DIR) {
		const intermediates = segments.slice(1, -1);
		const isHelper = intermediates.some((s) => (TEST_HELPER_DIRS as ReadonlyArray<string>).includes(s));
		return {
			verdict: isHelper ? "excluded" : "valid",
			workspace: owner.name,
			suggestedPath: null,
		};
	}

	return {
		verdict: "invalid",
		workspace: owner.name,
		suggestedPath: join(owner.path, TEST_DIR, basename(filePath)),
	};
}
