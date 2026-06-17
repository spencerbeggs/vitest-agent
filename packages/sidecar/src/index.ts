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
 * This package is built with rslib-builder (like the six lockstep
 * packages) for one decisive reason: rslib-builder emits a transformed
 * `dist/dev/package.json` with `workspace:*` / `catalog:` references
 * resolved. `publishConfig.linkDirectory: true` makes pnpm symlink
 * `node_modules/@vitest-agent/sidecar` at the publish directory
 * (`dist/dev`), so a consumer that declares this package as a
 * `workspace:*` dependency (notably `@vitest-agent/plugin`) needs a
 * real `package.json` to exist there. tsdown does not emit one — its
 * absence was the `Workspace resolution failed` failure in
 * `@vitest-agent/plugin#build:prod`.
 *
 * @packageDocumentation
 */

export { type ResolveSidecarBinaryPathOptions, resolveSidecarBinaryPath } from "./resolve-sidecar-binary-path.js";
