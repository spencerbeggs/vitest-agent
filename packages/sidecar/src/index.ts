/**
 * `@vitest-agent/sidecar` package entry.
 *
 * The sidecar's runtime artifacts are the four
 * `@vitest-agent/sidecar-<platform>` SEA binaries (optional
 * dependencies); each child declares the binary as its own `bin`
 * entry. The bin is NOT automatically discoverable via `command -v`
 * because pnpm/npm only hoist direct-dependency bins — transitive
 * optional-dependency bins are never placed in `node_modules/.bin/`.
 * Instead, the binary path is resolved at runtime via
 * `require.resolve` of the platform package's bin entry (not a PATH
 * lookup), implemented by {@link resolveSidecarBinaryPath} in this
 * package. The resolver MUST live here: `require.resolve` only finds
 * the optional platform packages when its module anchor
 * (`import.meta.url`) sits inside `@vitest-agent/sidecar`, which is the
 * package that declares them as `optionalDependencies`.
 *
 * Like every family package it builds with `effected package build`, which
 * emits the published manifest with `workspace:*` / `catalog:` references
 * resolved. Inside the workspace the link resolves to this package's
 * source, so a per-platform child resolves to its `src/bin.ts` (not an
 * executable) and the hooks fall back to the JS CLI; an installed consumer
 * resolves the child's `.` export, which is the prebuilt binary.
 *
 * @packageDocumentation
 */

export { type ResolveSidecarBinaryPathOptions, resolveSidecarBinaryPath } from "./resolve-sidecar-binary-path.js";
