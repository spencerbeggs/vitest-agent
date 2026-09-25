/**
 * The version of this package, inlined at build time from
 * `package.json#version` via rslib-builder's `__PACKAGE_VERSION__` substitution.
 * Lives in its own module so the `vitest-agent` bin shim can thread the
 * carrier's identity into `@vitest-agent/cli/main` without importing the
 * plugin graph; `plugin.ts` re-exports it as the public symbol.
 *
 * @public
 */
export const CURRENT_PLUGIN_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
