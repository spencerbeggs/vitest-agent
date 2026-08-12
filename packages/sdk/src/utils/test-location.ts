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
 * Directory names discovery never walks into, and therefore never collects
 * tests from. Keep in step with {@link TEST_FILE_GLOB_SUFFIX}'s extension set:
 * this is the directory half of the same "what can Vitest reach" question.
 *
 * `@vitest-agent/plugin`'s test-file walker and its cache-signature walk both
 * prune these before recursing (pruning first, rather than filtering results
 * after, is what keeps a symlinked `node_modules` from dragging in the whole
 * pnpm store), and {@link classifyTestPath} declines to render a verdict for
 * any path that crosses one.
 * @public
 */
export const NON_DISCOVERABLE_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist"]);

/**
 * Regex form of {@link TEST_FILE_GLOB_SUFFIX}. Anchored at the end of the
 * string, so it matches a bare basename and a full path alike. Change both
 * together — they are the same extension set in two notations.
 */
const TEST_FILE_SUFFIX_RE = /\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/;

/**
 * True when `filePathOrName` ends in a discoverable test-file suffix — the
 * extension half of the layout rule, matching {@link TEST_FILE_GLOB_SUFFIX}.
 *
 * Says nothing about location: a `node_modules` copy of `foo.test.ts` passes
 * this and is still not discoverable. Pair it with {@link classifyTestPath}
 * when the answer has to account for where the file sits.
 * @public
 */
export function isTestFileName(filePathOrName: string): boolean {
	return TEST_FILE_SUFFIX_RE.test(filePathOrName);
}

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
 * Returns the deepest supplied workspace containing `filePath`, or `null` when
 * none does. Attribution is by longest matching path, so a nested package wins
 * over the repository root that contains it.
 *
 * Exported because callers that need to reason about a path relative to its
 * owning package — walking down from the package root, for instance — must
 * agree with {@link classifyTestPath} about which package owns it.
 * @public
 */
export function findOwningWorkspace(workspaces: ReadonlyArray<WorkspaceLike>, filePath: string): WorkspaceLike | null {
	let owner: WorkspaceLike | null = null;
	for (const ws of workspaces) {
		if (!contains(ws.path, filePath)) continue;
		if (owner === null || ws.path.length > owner.path.length) owner = ws;
	}
	return owner;
}

/**
 * Classifies `filePath` against the test-layout rule: a test file is
 * discoverable only at `<workspace>/src/**` or `<workspace>/__test__/**`,
 * excluding the helper directories under `__test__/`.
 *
 * Returns `null` when no supplied workspace contains the path, and when the
 * path crosses one of the {@link NON_DISCOVERABLE_DIRS} discovery never walks
 * into. Neither is a verdict — it means the rule has nothing to say, and
 * callers must fail open rather than treat it as invalid.
 *
 * The rule is pure, so one boundary the walker honors cannot be checked here:
 * a nested `package.json` marks an independent unit whose tests belong to a
 * different discovery pass, and detecting one needs a filesystem probe. A
 * caller with filesystem access should apply that check itself and fail open
 * when it fires — `@vitest-agent/cli`'s `agent check-test-path` does.
 * @public
 */
export function classifyTestPath(
	workspaces: ReadonlyArray<WorkspaceLike>,
	filePath: string,
): TestPathClassification | null {
	const owner = findOwningWorkspace(workspaces, filePath);
	if (owner === null) return null;

	const segments = relative(owner.path, filePath).split(sep);

	// Discovery never walks into these, so nothing under one is collected — and
	// nothing under one is this workspace's business either. A vendored upstream
	// checkout or an installed dependency carries its own test files at its own
	// layout; rendering a verdict on them would advise moving someone else's
	// file into this repository's `__test__/`.
	if (segments.some((s) => NON_DISCOVERABLE_DIRS.has(s))) return null;

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
