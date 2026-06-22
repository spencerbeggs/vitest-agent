/**
 * Normalize a workspace name into a filesystem-safe directory segment.
 *
 * The workspace key drives the per-project subdirectory under the XDG data
 * directory (e.g. `$XDG_DATA_HOME/vitest-agent/<key>/data.db`). The
 * key must be deterministic for a given input and safe to use as a single
 * path segment on macOS, Linux, and Windows.
 *
 * Rules (applied in order):
 *
 * 1. Replace `/` with `__` so scoped names like `@org/pkg` collapse to
 *    `@org__pkg` rather than introducing a subdirectory boundary. Scoped
 *    npm names contain at most one `/` (between scope and name), and
 *    leading-`@` requires the scope/name form, so `@org__pkg` is not a
 *    valid unscoped npm name -- the `__` token is unambiguous in
 *    practice.
 * 2. Replace any character outside `[A-Za-z0-9._@-]` with `_`. This catches
 *    Windows-reserved characters (`\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`),
 *    control characters, whitespace, and anything else that varies in
 *    interpretation across filesystems.
 * 3. Collapse runs of underscores produced by the substitution above into a
 *    single `_` so the output stays compact.
 *
 * @param name - The raw `name` field from a workspace's `package.json`.
 * @returns A filesystem-safe single path segment.
 * @public
 */
export function normalizeWorkspaceKey(name: string): string {
	return name
		.replaceAll("/", "__")
		.replace(/[^A-Za-z0-9._@-]/g, "_")
		.replace(/_{3,}/g, "__");
}
