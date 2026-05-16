/**
 * tsdown SEA build config for `vitest-agent-sidecar-darwin-arm64`.
 *
 * This child compiles ITS OWN platform binary — a Node Single
 * Executable Application for darwin/arm64 — from its own `src/bin.ts`,
 * which imports the argv dispatcher from `vitest-agent-cli`.
 *
 * `onSuccess` is the shared `sidecarDist` handler (lib/configs): it
 * runs after the SEA `exe` step, renames the binary, and emits the
 * dist/ publish variants. The build mode (dev vs prod) is read from
 * `SIDECAR_DIST_MODE`, set by the `build:dev` / `build:prod` scripts.
 *
 * The SEA `exe` build requires Node >= 25.7.0 and `@tsdown/exe`.
 */

import { defineConfig } from "tsdown";
import { sidecarDist } from "../../lib/configs/sidecar-dist.ts";

const TARGET = { platform: "darwin", arch: "arm64", nodeVersion: "25.9.0" } as const;

export default defineConfig({
	entry: ["src/bin.ts"],
	format: "esm",
	platform: "node",
	outDir: "dist",
	clean: true,
	// A SEA binary is a single self-contained file: every non-builtin
	// dependency must be bundled, since none are resolvable from disk
	// at runtime inside the SEA.
	deps: {
		alwaysBundle: (id: string) => !id.startsWith("node:"),
	},
	exe: {
		fileName: "vitest-agent-sidecar",
		outDir: "bin",
		seaConfig: {
			disableExperimentalSEAWarning: true,
			// Both MUST stay false for a cross-platform target build.
			useCodeCache: false,
			useSnapshot: false,
		},
		targets: [TARGET],
	},
	onSuccess: sidecarDist({ platform: TARGET.platform, arch: TARGET.arch }),
});
