/**
 * tsdown build config for vitest-agent-sidecar.
 *
 * Two build modes, selected by the `VITEST_AGENT_SIDECAR_EXE` env var:
 *
 *   - unset  (`build:dev`)  — a plain JS bundle for fast local
 *                             feedback. `exe` is `false`.
 *   - `"1"`  (`build:prod`) — the full Node SEA `exe` build, producing
 *                             a native binary per target platform.
 *
 * IMPORTANT: the SEA `exe` build requires Node >= 25.7.0 and the
 * `@tsdown/exe` package. The `node` on a default PATH may be older —
 * run `build:prod` under Node 25.x. tsdown disables declaration
 * generation and code splitting in `exe` mode; a single entry point is
 * the only supported shape.
 *
 * For multi-platform builds `useCodeCache` and `useSnapshot` MUST stay
 * `false` — code cache and startup snapshots are tied to the building
 * host's V8 build and do not survive a cross-platform target.
 *
 * Note: `vitest-agent-cli` and `vitest-agent-sdk` are intentionally
 * NOT externalized. A SEA binary is a single self-contained file, so
 * the workspace deps (and the Effect runtime they pull in) must be
 * bundled — they would not be resolvable at runtime inside the SEA.
 */

import { defineConfig } from "tsdown";

const exeEnabled = process.env.VITEST_AGENT_SIDECAR_EXE === "1";

export default defineConfig({
	entry: ["src/bin.ts"],
	format: "esm",
	platform: "node",
	outDir: "dist",
	clean: true,
	// A SEA binary is a single self-contained file: every non-builtin
	// dependency — the workspace packages AND the Effect runtime they
	// pull in — must be bundled, since none of them are resolvable from
	// disk at runtime inside the SEA. `deps.alwaysBundle` overrides
	// tsdown's default of externalizing `dependencies`.
	deps: {
		alwaysBundle: (id: string) => !id.startsWith("node:"),
	},
	exe: exeEnabled
		? {
				fileName: "vitest-agent-sidecar",
				seaConfig: {
					disableExperimentalSEAWarning: true,
					// Both MUST stay false for multi-platform target builds.
					useCodeCache: false,
					useSnapshot: false,
				},
				targets: [
					{ platform: "darwin", arch: "arm64", nodeVersion: "25.9.0" },
					{ platform: "darwin", arch: "x64", nodeVersion: "25.9.0" },
					{ platform: "linux", arch: "arm64", nodeVersion: "25.9.0" },
					{ platform: "linux", arch: "x64", nodeVersion: "25.9.0" },
					{ platform: "win", arch: "x64", nodeVersion: "25.9.0" },
				],
			}
		: false,
});
