import type { ClassifyContext, ClassifyFn } from "./discover-strategy.js";
import { toPosixPath } from "./to-posix-path.js";

/**
 * Creates a ClassifyFn that maps filename suffix patterns to tag arrays.
 *
 * Accepts two forms:
 * - `Record<string, ReadonlyArray<string>>` — keys are exact suffix strings
 *   (e.g. ".int.test.ts"); matched via `String.prototype.endsWith` against
 *   `module.filename`.
 * - `ReadonlyArray<readonly [RegExp, ReadonlyArray<string>]>` — each tuple is a
 *   `[pattern, tags]` pair; matched via `RegExp.test` against `module.filename`.
 *   First match wins.
 *
 * No match returns an empty array.
 * @public
 */
export function classifyByFilename(
	suffixMap: Record<string, ReadonlyArray<string>> | ReadonlyArray<readonly [RegExp, ReadonlyArray<string>]>,
): ClassifyFn {
	if (Array.isArray(suffixMap)) {
		// Tuple array form: [RegExp, tags][]
		const entries = suffixMap as ReadonlyArray<readonly [RegExp, ReadonlyArray<string>]>;
		return (ctx: ClassifyContext): ReadonlyArray<string> => {
			for (const [pattern, tags] of entries) {
				if (pattern.test(ctx.module.filename)) {
					return tags;
				}
			}
			return [];
		};
	}

	// Record form: { suffix: tags }
	const entries = Object.entries(suffixMap as Record<string, ReadonlyArray<string>>);
	return (ctx: ClassifyContext): ReadonlyArray<string> => {
		for (const [suffix, tags] of entries) {
			if (ctx.module.filename.endsWith(suffix)) {
				return tags;
			}
		}
		return [];
	};
}

/**
 * Creates a ClassifyFn that maps directory segment paths to tag arrays.
 *
 * Keys are directory-segment paths (e.g. `__test__/integration`). A module
 * matches when `module.relativePath` contains the segment with `/` boundaries.
 * Key `"integration"` matches `"integration/foo.test.ts"` and
 * `"src/integration/foo.test.ts"` but NOT `"my-integration-tests/foo.test.ts"`.
 *
 * No match returns `[]`.
 * @public
 */
export function classifyByDirectory(dirMap: Record<string, ReadonlyArray<string>>): ClassifyFn {
	const entries = Object.entries(dirMap);
	return (ctx: ClassifyContext): ReadonlyArray<string> => {
		// Defensive normalization. buildModuleInfo already canonicalizes
		// relativePath to forward slashes, but custom DiscoverStrategy
		// implementations may build ModuleInfo themselves and supply a
		// platform-native path. toPosixPath keeps the slash-bounded match
		// semantics documented above identical on Windows.
		const rel = toPosixPath(ctx.module.relativePath);
		for (const [segment, tags] of entries) {
			// Match with slash boundaries:
			// - starts with segment followed by /
			// - ends with / followed by segment
			// - contains /segment/
			if (
				rel === segment ||
				rel.startsWith(`${segment}/`) ||
				rel.endsWith(`/${segment}`) ||
				rel.includes(`/${segment}/`)
			) {
				return tags;
			}
		}
		return [];
	};
}

/**
 * Composes multiple `ClassifyFn` values into one. Each classifier is called with
 * the same context; results are concatenated in order and deduplicated by tag
 * name (first occurrence wins). An empty list returns a function that always
 * returns `[]`.
 * @public
 */
export function combineClassifiers(...fns: ReadonlyArray<ClassifyFn>): ClassifyFn {
	if (fns.length === 0) {
		return (_ctx: ClassifyContext): ReadonlyArray<string> => [];
	}
	return (ctx: ClassifyContext): ReadonlyArray<string> => {
		const seen = new Set<string>();
		const result: string[] = [];
		for (const fn of fns) {
			for (const tag of fn(ctx)) {
				if (!seen.has(tag)) {
					seen.add(tag);
					result.push(tag);
				}
			}
		}
		return result;
	};
}
