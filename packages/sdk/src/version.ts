/**
 * The version of this package. Inlined at build time from
 * package.json#version via rslib-builder's __PACKAGE_VERSION__ substitution.
 * Source-level reads (workspace `exports: "./src/index.ts"` during dev)
 * see the `"0.0.0"` fallback — a clear signal the build pipeline has not
 * substituted yet. Exported for version introspection by downstream tooling.
 *
 * This is the one sanctioned `process` read in the platform-free core: the
 * bundler replaces the token at build time, so no runtime `process` access
 * survives into the published artifact.
 * @public
 */
export const CURRENT_SDK_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
