/**
 * `vitest-agent-sidecar` package entry.
 *
 * The parent package's published JS bundle. It re-exports the shared
 * argv dispatcher from `bin.ts` so the dispatch logic has a single
 * home: the five `vitest-agent-sidecar-<platform>` child packages
 * compile their SEA binaries straight from `src/bin.ts`, and
 * this `index.ts` is what rslib-builder bundles for the package's `.`
 * export. Keeping `bin.ts` as the SEA entry and `index.ts` as the
 * library entry lets rslib emit a conventional `index.js` whose name
 * matches the generated `exports` map.
 *
 * @packageDocumentation
 */

export { type DispatchResult, dispatch } from "./bin.js";
