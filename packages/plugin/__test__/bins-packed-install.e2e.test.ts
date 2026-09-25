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
 * - `vitest-agent --version` (`consumer.runBin`) exits 0. Which package the
 *   `.bin` entry belongs to decides the suffix: `consumer.binProvenance`
 *   names it for the symlinking managers (npm, yarn, bun). The carrier's
 *   shim must print ` via @vitest-agent/plugin <version>`; a hoisted
 *   `@vitest-agent/cli` mirror bin (the kit's documented flat-layout wart)
 *   must not. pnpm writes shell shims (provenance `undefined`), so there the
 *   proof is the isolated layout: `@vitest-agent/cli` is not linked at the
 *   consumer's top level, and the suffix is required.
 * - `vitest-agent-mcp` passes `McpProbe.initialize` (`@effected/mcp/testing`):
 *   no JSON-RPC error, empty stderr, exit 0.
 *
 * Every bin runs with `XDG_DATA_HOME` inside `result.scratch`, so the
 * developer's real data directory is never touched and the data is removed
 * with the scratch root.
 *
 * Gates: the suite skips unless the plugin's prod build exists (`pnpm
 * build`). Manager availability is `require`: every manager is required
 * under CI; locally a missing one is skipped and logged.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { McpProbe } from "@effected/mcp/testing";
import { Workspaces } from "@effected/workspaces";
import { PackedInstall } from "@effected/workspaces/testing";
import { Duration, Effect, FileSystem, Layer } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const PLUGIN_PROD_MANIFEST = join(REPO_ROOT, "packages", "plugin", "dist", "prod", "npm", "pkg", "package.json");
const PROD_BUILD_PRESENT = existsSync(PLUGIN_PROD_MANIFEST);

const CARRIER = "@vitest-agent/plugin";
const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
const INSTALL_TIMEOUT = "3 minutes";
const BIN_TIMEOUT = "60 seconds";

interface Manifest {
	readonly name: string;
	readonly version: string;
	readonly dependencies?: Record<string, string>;
	readonly optionalDependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
}

const readManifest = (path: string): Manifest => JSON.parse(readFileSync(path, "utf-8")) as Manifest;

/**
 * How many packages `closure: "auto"` packs: the carrier plus its transitive
 * runtime workspace dependencies, by the kit's rule (`dependencies`,
 * `optionalDependencies`, `peerDependencies`; never `devDependencies`).
 *
 * The vitest timeout is fixed when the test is declared, before
 * `PackedInstall.run` resolves the closure, so the count is taken here from
 * the source manifests (every `@vitest-agent/*` package lives under
 * `packages/`) and cross-checked against `result.tarballs` after the run.
 */
const closureSize = (): number => {
	const byName = new Map<string, Manifest>();
	for (const entry of readdirSync(join(REPO_ROOT, "packages"))) {
		const path = join(REPO_ROOT, "packages", entry, "package.json");
		if (existsSync(path)) {
			const manifest = readManifest(path);
			byName.set(manifest.name, manifest);
		}
	}
	const seen = new Set([CARRIER]);
	const queue = [CARRIER];
	for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
		const manifest = byName.get(name);
		if (manifest === undefined) continue;
		for (const field of [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]) {
			for (const dependency of Object.keys(field ?? {})) {
				if (byName.has(dependency) && !seen.has(dependency)) {
					seen.add(dependency);
					queue.push(dependency);
				}
			}
		}
	}
	return seen.size;
};

const PACKAGE_COUNT = closureSize();

/**
 * The run's own ceilings, in sequence (the kit's arithmetic): every
 * manager's probe + install + per-consumer work (two bin runs), plus every
 * package's pack and manifest read, plus cleanup. The Effect times out at
 * the budget as a backstop; vitest's guard sits a minute above it so the
 * kit's named `PackedInstallError` always fires first.
 */
const RUN_BUDGET = PackedInstall.timeoutBudget({
	managers: MANAGERS,
	installTimeout: INSTALL_TIMEOUT,
	packages: PACKAGE_COUNT,
	// Two bin runs per consumer, each capped at BIN_TIMEOUT.
	perConsumer: "2 minutes",
});
const TEST_TIMEOUT_MS = Duration.toMillis(RUN_BUDGET) + 60_000;

const Live = Workspaces.layer({ cwd: REPO_ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

const SUITE_NAME = PROD_BUILD_PRESENT
	? "packed-install"
	: "packed-install (skipped: needs `pnpm build` — no packages/plugin/dist/prod/npm/pkg)";

// PackedInstall is POSIX-only (it fails UnsupportedPlatform elsewhere).
describe.skipIf(!PROD_BUILD_PRESENT || process.platform === "win32")(SUITE_NAME, () => {
	it(
		"the carrier's vitest-agent and vitest-agent-mcp bins work from a packed install under every available manager",
		async () => {
			const pluginVersion = readManifest(PLUGIN_PROD_MANIFEST).version;
			// The vitest peer range comes from the pnpm catalog, so no manifest in
			// the repo states it literally; the installed package is the one place
			// to read it. Read-only.
			const vitestVersion = readManifest(join(REPO_ROOT, "node_modules", "vitest", "package.json")).version;

			const program = Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const result = yield* PackedInstall.run({
					carrier: CARRIER,
					closure: "auto",
					managers: MANAGERS,
					bins: ["vitest-agent", "vitest-agent-mcp"],
					env: process.env,
					consumerDependencies: { vitest: vitestVersion },
					require: process.env.CI ? "all" : "any",
					installTimeout: INSTALL_TIMEOUT,
				});
				if (result.unavailable.length > 0) {
					yield* Effect.logWarning(`packed-install: skipped unavailable managers: ${result.unavailable.join(", ")}`);
				}
				// Keep vitest-agent off the developer's real data directory: inside the
				// scratch root, removed with it when the scope closes.
				const xdg = join(result.scratch, "xdg");
				yield* fs.makeDirectory(xdg, { recursive: true });
				const mcpEnv = { ...PackedInstall.scrubEnv(process.env), XDG_DATA_HOME: xdg };
				const outcomes = [];
				for (const consumer of result.consumers) {
					const provenance = yield* consumer.binProvenance("vitest-agent");
					const version = yield* consumer.runBin("vitest-agent", ["--version"], {
						env: { XDG_DATA_HOME: xdg },
						timeout: BIN_TIMEOUT,
					});
					// McpProbe takes a Command, not a consumer, so it rebuilds the env
					// runBin starts from (the install's scrubbed env) by hand.
					const probe = yield* McpProbe.initialize(
						ChildProcess.make(consumer.binPath("vitest-agent-mcp"), [], {
							cwd: consumer.directory,
							env: mcpEnv,
							extendEnv: false,
						}),
					).pipe(Effect.timeout(BIN_TIMEOUT));
					const cliLinkedAtTopLevel = yield* fs.exists(
						join(consumer.directory, "node_modules", "@vitest-agent", "cli", "package.json"),
					);
					outcomes.push({ manager: consumer.manager, provenance, version, probe, cliLinkedAtTopLevel });
				}
				return { packed: Object.keys(result.tarballs).length, consumers: result.consumers.length, outcomes };
			}).pipe(Effect.scoped, Effect.timeout(RUN_BUDGET), Effect.provide(Live));

			const { packed, consumers, outcomes } = await Effect.runPromise(program);
			// The budget was sized from PACKAGE_COUNT; the kit's closure must agree.
			expect(packed, "closure size the timeout budget assumed").toBe(PACKAGE_COUNT);
			expect(consumers).toBeGreaterThan(0);

			const suffix = `via ${CARRIER} ${pluginVersion}`;
			for (const { manager, provenance, version, probe, cliLinkedAtTopLevel } of outcomes) {
				expect(version.exitCode, `${manager}: vitest-agent --version\n${version.stderr}`).toBe(0);
				expect(version.stdout, manager).toMatch(/\d+\.\d+\.\d+/);
				if (provenance === undefined) {
					// Only pnpm writes a shell shim instead of a symlink.
					expect(manager, "a non-symlink .bin entry").toBe("pnpm");
					// Isolated layout: only the consumer's direct dependency (the
					// carrier) is linked at the top level, so the bin that ran is the
					// carrier's shim, not a hoisted @vitest-agent/cli one.
					expect(cliLinkedAtTopLevel, "pnpm: @vitest-agent/cli must not be linked at the top level").toBe(false);
					expect(version.stdout, "pnpm: --version names the carrier").toContain(suffix);
				} else if (provenance.package === CARRIER) {
					expect(version.stdout, `${manager}: the carrier's shim names the carrier`).toContain(suffix);
				} else {
					// A flat layout linked the hoisted mirror bin over the carrier's
					// shim: the same main(), minus the carrier identity.
					expect(provenance.package, `${manager}: vitest-agent bin owner`).toBe("@vitest-agent/cli");
					expect(version.stdout, `${manager}: the cli mirror bin carries no carrier suffix`).not.toContain(" via ");
				}
				expect(probe.response.error, `${manager}: initialize answered an error`).toBeUndefined();
				expect(probe.stderr, `${manager}: vitest-agent-mcp stderr`).toBe("");
				expect(probe.exitCode, `${manager}: vitest-agent-mcp exit code`).toBe(0);
			}
		},
		TEST_TIMEOUT_MS,
	);
});
