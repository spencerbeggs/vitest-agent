/**
 * Normalize a filesystem path to forward-slash separators.
 *
 * Single source of truth for the POSIX-style path strings the plugin uses
 * in three places where the path is compared against a slash-only pattern
 * or surfaced to user code that documents slash semantics:
 *
 * - `buildModuleInfo.relativePath` — consumed by user-supplied `ClassifyFn`
 *   implementations and by the bundled `classifyByDirectory` helper.
 * - `find-test-files` regex matching — `globToRegex` compiles patterns
 *   with `/` boundaries.
 * - `discoverProjects` `addProject` relativePath — passed to
 *   `strategy.buildProject` and exposed via `DiscoverInput.relativePath`.
 *
 * Always folds backslashes to forward slashes regardless of the host
 * platform. On POSIX the call is effectively a no-op for paths produced
 * by `node:path` operations (they never contain backslashes there) but
 * still defends against custom DiscoverStrategy implementations that
 * pass through a Windows-style path string. On Windows, where `node:path`
 * returns backslash separators, this folds them so glob matching and
 * slash-bounded segment checks both work without platform-specific
 * branching at every call site.
 *
 * Returns the input unchanged when no backslashes are present — only the
 * separator characters are touched. Callers that need the platform-native
 * form (e.g. for `readFile`) should pass the original path produced by
 * `join` rather than the value returned here.
 */
export function toPosixPath(p: string): string {
	return p.indexOf("\\") === -1 ? p : p.split("\\").join("/");
}
