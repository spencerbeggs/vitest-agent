/**
 * The version of this package, inlined at build time from
 * `package.json#version` via the bundler's `__PACKAGE_VERSION__` substitution.
 * Exported for version introspection by downstream tooling, and consumed by
 * `main.ts` to back the advertised `serverInfo.version`.
 *
 * @public
 */
export const CURRENT_MCP_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
