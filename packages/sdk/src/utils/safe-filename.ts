/**
 * @vitest-agent/sdk
 *
 * Convert a project name to a filesystem-safe filename.
 *
 * @packageDocumentation
 */

/**
 * Convert a project name to a filesystem-safe filename.
 *
 * Replaces `/` and `:` characters with `__` (double underscore).
 * Returns `"default"` for empty strings, which is used as the
 * fallback project name for single-repo configurations.
 *
 * @param name - Project name to sanitize
 * @returns Filesystem-safe filename string
 *
 * @example
 * ```typescript
 * import { safeFilename } from "@vitest-agent/sdk/utils";
 *
 * safeFilename("\@savvy-web/my-lib:unit");
 * // Returns: "\@savvy-web__my-lib__unit"
 *
 * safeFilename("core");
 * // Returns: "core"
 *
 * safeFilename("");
 * // Returns: "default"
 * ```
 *
 * @public
 */
export function safeFilename(name: string): string {
	if (!name) return "default";
	return name.replace(/[/:]/g, "__");
}
