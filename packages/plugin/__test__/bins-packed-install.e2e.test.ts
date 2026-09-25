/**
 * Packed-install e2e: proves the carrier's bins reach a consumer that is
 * NOT part of this monorepo, once per available package manager.
 *
 * `PackedInstall.run` (`@effected/workspaces/testing`) packs
 * `@vitest-agent/plugin` and its runtime workspace closure from each
 * package's `dist/prod/npm/pkg`, installs the carrier tarball into a scratch
 * consumer under npm, pnpm, yarn and bun (closure overridden to its
 * tarballs), and checks `node_modules/.bin/vitest-agent` and
 * `vitest-agent-mcp` exist and are executable. This file then runs them,
 * inside the same scope (the scratch directory is removed when it closes):
 *
 * - `vitest-agent --version` exits 0 and names the carrier
 *   (` via @vitest-agent/plugin <version>`), which only the plugin's bin
 *   shim threads down to the CLI.
 * - Under pnpm's isolated layout `@vitest-agent/cli` is not linked at the
 *   consumer's top level, so the bin on `.bin` can only be the carrier's.
 * - `vitest-agent-mcp` passes `McpProbe.initialize` (`@effected/mcp/testing`):
 *   no JSON-RPC error, empty stderr, exit 0.
 *
 * Gates: the suite skips unless the plugin's prod build exists (`pnpm
 * build`). Manager availability is `require`: every manager is required
 * under CI; locally a missing one is skipped and logged.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { McpProbe } from "@effected/mcp/testing";
import { Workspaces } from "@effected/workspaces";
import { PackedInstall } from "@effected/workspaces/testing";
import { Effect, FileSystem, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const PLUGIN_PROD_MANIFEST = join(REPO_ROOT, "packages", "plugin", "dist", "prod", "npm", "pkg", "package.json");
const PROD_BUILD_PRESENT = existsSync(PLUGIN_PROD_MANIFEST);

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
// Sequential installs: the outer guard must cover every manager's ceiling
// plus the pack and each consumer's two bin runs.
const INSTALL_TIMEOUT = "3 minutes";
const BIN_TIMEOUT = "60 seconds";
const RUN_TIMEOUT = "22 minutes";
const TEST_TIMEOUT_MS = 23 * 60_000;

const Live = Workspaces.layer({ cwd: REPO_ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

const readVersion = (manifest: string): string =>
	(JSON.parse(readFileSync(manifest, "utf-8")) as { version: string }).version;

const collect = (stream: Stream.Stream<Uint8Array, unknown>) =>
	Stream.runCollect(stream).pipe(Effect.map((chunks) => Buffer.concat(Array.from(chunks)).toString("utf-8")));

/** Run `command` to completion: stdout, stderr and the exit code. */
const runBin = (command: ChildProcess.Command) =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(command);
			const [stdout, stderr, exitCode] = yield* Effect.all(
				[collect(handle.stdout), collect(handle.stderr), handle.exitCode],
				{ concurrency: "unbounded" },
			);
			return { stdout, stderr, exitCode: Number(exitCode) };
		}),
	);

const SUITE_NAME = PROD_BUILD_PRESENT
	? "packed-install"
	: "packed-install (skipped: needs `pnpm build` — no packages/plugin/dist/prod/npm/pkg)";

// PackedInstall is POSIX-only (it fails UnsupportedPlatform elsewhere).
describe.skipIf(!PROD_BUILD_PRESENT || process.platform === "win32")(SUITE_NAME, () => {
	it(
		"the carrier's vitest-agent and vitest-agent-mcp bins work from a packed install under every available manager",
		async () => {
			const pluginVersion = readVersion(PLUGIN_PROD_MANIFEST);
			// The vitest peer range comes from the pnpm catalog, so no manifest in
			// the repo states it literally; the installed package is the one place
			// to read it. Read-only.
			const vitestVersion = readVersion(join(REPO_ROOT, "node_modules", "vitest", "package.json"));

			const program = Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				// Keep vitest-agent off the developer's real data directory.
				const xdg = yield* fs.makeTempDirectoryScoped({ prefix: "vitest-agent-packed-xdg-" });
				const env = { ...process.env, XDG_DATA_HOME: xdg };
				const result = yield* PackedInstall.run({
					carrier: "@vitest-agent/plugin",
					closure: "auto",
					managers: MANAGERS,
					bins: ["vitest-agent", "vitest-agent-mcp"],
					env,
					consumerDependencies: { vitest: vitestVersion },
					require: process.env.CI ? "all" : "any",
					installTimeout: INSTALL_TIMEOUT,
				});
				if (result.unavailable.length > 0) {
					yield* Effect.logWarning(`packed-install: skipped unavailable managers: ${result.unavailable.join(", ")}`);
				}
				const binEnv = PackedInstall.scrubEnv(env);
				const outcomes = [];
				for (const consumer of result.consumers) {
					const options = { cwd: consumer.directory, env: binEnv, extendEnv: false } as const;
					const version = yield* runBin(
						ChildProcess.make(consumer.binPath("vitest-agent"), ["--version"], { ...options, stdin: "ignore" }),
					).pipe(Effect.timeout(BIN_TIMEOUT));
					const probe = yield* McpProbe.initialize(
						ChildProcess.make(consumer.binPath("vitest-agent-mcp"), [], options),
					).pipe(Effect.timeout(BIN_TIMEOUT));
					const cliLinkedAtTopLevel = yield* fs.exists(
						join(consumer.directory, "node_modules", "@vitest-agent", "cli", "package.json"),
					);
					outcomes.push({ manager: consumer.manager, version, probe, cliLinkedAtTopLevel });
				}
				return { consumers: result.consumers.length, outcomes };
			}).pipe(Effect.scoped, Effect.timeout(RUN_TIMEOUT), Effect.provide(Live));

			const { consumers, outcomes } = await Effect.runPromise(program);
			expect(consumers).toBeGreaterThan(0);

			for (const { manager, version, probe, cliLinkedAtTopLevel } of outcomes) {
				expect(version.exitCode, `${manager}: vitest-agent --version\n${version.stderr}`).toBe(0);
				expect(version.stdout, manager).toMatch(/\d+\.\d+\.\d+/);
				expect(version.stdout, `${manager}: --version names the carrier`).toContain(
					`via @vitest-agent/plugin ${pluginVersion}`,
				);
				if (manager === "pnpm") {
					// Isolated layout: only the consumer's direct dependency (the
					// carrier) is linked at the top level, so the bin that ran is the
					// carrier's shim, not a hoisted @vitest-agent/cli one.
					expect(cliLinkedAtTopLevel, "pnpm: @vitest-agent/cli must not be linked at the top level").toBe(false);
				}
				expect(probe.response.error, `${manager}: initialize answered an error`).toBeUndefined();
				expect(probe.stderr, `${manager}: vitest-agent-mcp stderr`).toBe("");
				expect(probe.exitCode, `${manager}: vitest-agent-mcp exit code`).toBe(0);
			}
		},
		TEST_TIMEOUT_MS,
	);
});
