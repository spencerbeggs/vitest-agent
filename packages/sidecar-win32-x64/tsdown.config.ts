/**
 * tsdown SEA build config for `vitest-agent-sidecar-win32-x64`.
 *
 * This child package compiles ITS OWN platform binary — a Node Single
 * Executable Application (SEA) for `win/x64` only. The five
 * `vitest-agent-sidecar-<platform>` children carry an identical config
 * apart from the single `targets` entry and the rename extension.
 *
 * The `entry` is this package's OWN `src/bin.ts` — a thin runner that
 * imports the argv dispatcher from `vitest-agent-cli` as a normal
 * package dependency. No cross-package filesystem paths: the
 * dispatcher logic is single-sourced in `vitest-agent-cli`
 * (`lib/sidecar-dispatch.ts`) and consumed here via a clean import.
 *
 * Build mechanics:
 *   - `exe.targets` has a SINGLE element — this child builds one
 *     platform. tsdown still appends a `-<platform>-<arch>` suffix to
 *     the SEA file name whenever `targets` is set, so the `onSuccess`
 *     hook renames the produced binary to the bare `vitest-agent-
 *     sidecar` name the package's `files` field expects.
 *   - `exe.outDir` is `bin/`, so the renamed binary lands at
 *     `bin/vitest-agent-sidecar` — matching the `files` entry and
 *     the parent launcher's `<pkg>/bin/<binaryName>` runtime
 *     resolution.
 *   - `useCodeCache` / `useSnapshot` stay `false`: V8 code caches and
 *     startup snapshots are tied to the building host's V8 build and
 *     do not survive a cross-platform target.
 *
 * The SEA `exe` build requires Node >= 25.7.0 and `@tsdown/exe`. Run
 * `build:prod` under Node 25.x.
 */

import { rename } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "tsdown";

// This child builds exactly one target. tsdown's exe platform token is
// `win`; the published `os` value is `win32`.
const TARGET = { platform: "win", arch: "x64", nodeVersion: "25.9.0" } as const;
// `.exe` on Windows targets, empty elsewhere.
const BIN_EXT = ".exe";

export default defineConfig({
	// This package's own thin runner; it imports `dispatch` from
	// `vitest-agent-cli` — a normal package import, bundled into the
	// SEA below.
	entry: ["src/bin.ts"],
	format: "esm",
	platform: "node",
	outDir: "dist",
	clean: true,
	// A SEA binary is a single self-contained file: every non-builtin
	// dependency — the workspace packages (`vitest-agent-cli`,
	// `vitest-agent-sdk`) AND the Effect runtime they pull in — must be
	// bundled, since none of them are resolvable from disk at runtime
	// inside the SEA. `deps.alwaysBundle` overrides tsdown's default of
	// externalizing `dependencies`.
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
	// tsdown appends `-<platform>-<arch>` to the SEA file name whenever
	// `targets` is set. Rename the single produced binary to the bare
	// `vitest-agent-sidecar` name the `files` field publishes.
	async onSuccess() {
		const built = resolve(`bin/vitest-agent-sidecar-${TARGET.platform}-${TARGET.arch}${BIN_EXT}`);
		const final = resolve(`bin/vitest-agent-sidecar${BIN_EXT}`);
		await rename(built, final);
	},
});
