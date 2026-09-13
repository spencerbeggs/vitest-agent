/**
 * The version of this package, inlined at build time from
 * `package.json#version` via rslib-builder's `__PACKAGE_VERSION__` substitution.
 * Exported for version introspection by downstream tooling, and consumed by
 * `main.ts` to back `Command.run`'s `version` option.
 *
 * @public
 */
export const CURRENT_CLI_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
