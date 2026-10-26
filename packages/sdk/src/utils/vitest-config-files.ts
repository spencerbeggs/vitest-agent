/**
 * The config filenames Vitest 5 itself loads, in the order it prefers them:
 * `vitest.config.*` before `vite.config.*`, each across
 * `ts` / `mts` / `cts` / `js` / `mjs` / `cjs`. Mirrors `configFiles` in
 * Vitest's own `constants.ts`. `vitest.workspace.*` is absent on purpose:
 * Vitest no longer reads a workspace file (projects live in the config's
 * `test.projects`).
 *
 * The single source both front ends derive their config lookups from, so the
 * CLI's `check-test-path` and the MCP `run_tests` root walk cannot drift.
 *
 * @public
 */
export const VITEST_CONFIG_FILES: ReadonlyArray<string> = ["vitest.config", "vite.config"].flatMap((name) =>
	["ts", "mts", "cts", "js", "mjs", "cjs"].map((ext) => `${name}.${ext}`),
);
