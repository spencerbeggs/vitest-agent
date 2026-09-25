/**
 * Packed-install e2e: proves the carrier's bins reach a consumer that is
 * NOT part of this monorepo, once per available package manager.
 *
 * `PackedInstall.run` (`@effected/workspaces/testing`) packs
 * `@vitest-agent/plugin` and its runtime workspace closure from each
 * package's `dist/prod/npm/pkg`, installs the carrier tarball into a scratch
 * consumer under npm, pnpm, yarn and bun (closure overridden to its
 * tarballs), and checks `node_modules/.bin/vitest-agent` and
 * `vitest-agent-mcp` exist and are executable. `workspaceOverrides: true`
 * carries the root `pnpm-workspace.yaml`'s `file:` overrides (a dogfood link
 * to a sibling checkout's unreleased build) into every consumer, so the
 * closure's transitive references resolve the same builds the workspace does.
 *
 * The front ends (`@vitest-agent/cli`, `@vitest-agent/mcp`) deliberately
 * keep their own bins under the carrier's bin names, so the run passes
 * `allowSharedBins: true`. This file then runs the bins, inside the same
 * scope (the scratch directory is removed when it closes):
 *
 * - `vitest-agent --version` (`consumer.runBin`) exits 0. Which package the
 *   `.bin` entry belongs to decides the suffix: `consumer.binProvenance`
 *   names it for the symlinking managers (npm, yarn, bun), and exactly two
 *   outcomes pass there: the carrier's shim WITH the
 *   ` via @vitest-agent/plugin <version>` suffix, or a hoisted
 *   `@vitest-agent/cli` bin WITHOUT any ` via ` suffix. pnpm writes shell
 *   shims (provenance `undefined`), so there the proof is the isolated
 *   layout: `@vitest-agent/cli` is not linked at the consumer's top level,
 *   and the suffix is required.
 * - `vitest-agent-mcp` passes `McpProbe.initialize` (`@effected/mcp/testing`)
 *   spawned through `consumer.command`: no JSON-RPC error, empty stderr,
 *   exit 0.
 *
 * Every bin runs with `XDG_DATA_HOME` inside `result.scratch`, so the
 * developer's real data directory is never touched and the data is removed
 * with the scratch root.
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
import type { PackedInstallOptions } from "@effected/workspaces/testing";
import { PackedInstall } from "@effected/workspaces/testing";
import { Duration, Effect, FileSystem, Layer } from "effect";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const PLUGIN_PROD_MANIFEST = join(REPO_ROOT, "packages", "plugin", "dist", "prod", "npm", "pkg", "package.json");
const PROD_BUILD_PRESENT = existsSync(PLUGIN_PROD_MANIFEST);
// PackedInstall is POSIX-only (it fails UnsupportedPlatform elsewhere).
const RUNNABLE = PROD_BUILD_PRESENT && process.platform !== "win32";

const CARRIER = "@vitest-agent/plugin";
const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
const INSTALL_TIMEOUT = "3 minutes";
const PACK_TIMEOUT = "30 seconds";
const BIN_TIMEOUT = "60 seconds";

const readManifest = (path: string): { readonly version: string } =>
	JSON.parse(readFileSync(path, "utf-8")) as { readonly version: string };

const Live = Workspaces.layer({ cwd: REPO_ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * The run's options, as ONE object: `PackedInstall.closure` plans with the
 * same implementation as `run`, so handing it this object yields exactly the
 * names `run` will pack (`Object.keys(result.tarballs)`), overrides included.
 */
const RUN_OPTIONS: PackedInstallOptions = {
	carrier: CARRIER,
	closure: "auto",
	workspaceOverrides: true,
	managers: MANAGERS,
	bins: ["vitest-agent", "vitest-agent-mcp"],
	env: process.env,
	// The vitest peer range comes from the pnpm catalog, so no manifest in the
	// repo states it literally; the installed package is the one place to
	// read it. Read-only.
	consumerDependencies: RUNNABLE
		? { vitest: readManifest(join(REPO_ROOT, "node_modules", "vitest", "package.json")).version }
		: {},
	require: process.env.CI ? "all" : "any",
	installTimeout: INSTALL_TIMEOUT,
	packTimeout: PACK_TIMEOUT,
	// Deliberate, not a migration shim: the front ends are independently
	// runnable, so `@vitest-agent/cli` and `@vitest-agent/mcp` keep declaring
	// the carrier's bin names. Under a flat layout either package can take the
	// `.bin` slot; losing the carrier's provenance there is accepted, and the
	// test asserts which of the two it got instead (see below).
	allowSharedBins: true,
};

/**
 * What the run will pack. vitest fixes a test's timeout when the test is
 * declared, so the closure is planned here, at module evaluation (top-level
 * await), before `describe` runs — no hand-rolled manifest walk. Skipped
 * (empty) when the suite cannot run.
 */
const PACKED: ReadonlyArray<string> = RUNNABLE
	? await Effect.runPromise(PackedInstall.closure(CARRIER, RUN_OPTIONS).pipe(Effect.provide(Live)))
	: [];

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
	packTimeout: PACK_TIMEOUT,
	packages: PACKED,
	// Two bin runs per consumer, each capped at BIN_TIMEOUT.
	perConsumer: "2 minutes",
});
const TEST_TIMEOUT_MS = Duration.toMillis(RUN_BUDGET) + 60_000;

const SUITE_NAME = PROD_BUILD_PRESENT
	? "packed-install"
	: "packed-install (skipped: needs `pnpm build` — no packages/plugin/dist/prod/npm/pkg)";

describe.skipIf(!RUNNABLE)(SUITE_NAME, () => {
	it(
		"the carrier's vitest-agent and vitest-agent-mcp bins work from a packed install under every available manager",
		async () => {
			const pluginVersion = readManifest(PLUGIN_PROD_MANIFEST).version;

			const program = Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const result = yield* PackedInstall.run(RUN_OPTIONS);
				if (result.unavailable.length > 0) {
					yield* Effect.logWarning(`packed-install: skipped unavailable managers: ${result.unavailable.join(", ")}`);
				}
				// Keep vitest-agent off the developer's real data directory: inside the
				// scratch root, removed with it when the scope closes.
				const xdg = join(result.scratch, "xdg");
				yield* fs.makeDirectory(xdg, { recursive: true });
				const env = { XDG_DATA_HOME: xdg };
				const outcomes = [];
				for (const consumer of result.consumers) {
					const provenance = yield* consumer.binProvenance("vitest-agent");
					const version = yield* consumer.runBin("vitest-agent", ["--version"], { env, timeout: BIN_TIMEOUT });
					const probe = yield* McpProbe.initialize(consumer.command("vitest-agent-mcp", [], { env })).pipe(
						Effect.timeout(BIN_TIMEOUT),
					);
					const cliLinkedAtTopLevel = yield* fs.exists(
						join(consumer.directory, "node_modules", "@vitest-agent", "cli", "package.json"),
					);
					outcomes.push({ manager: consumer.manager, provenance, version, probe, cliLinkedAtTopLevel });
				}
				return { packed: Object.keys(result.tarballs), consumers: result.consumers.length, outcomes };
			}).pipe(Effect.scoped, Effect.timeout(RUN_BUDGET), Effect.provide(Live));

			const { packed, consumers, outcomes } = await Effect.runPromise(program);
			// The budget was sized from the planned closure; the run must have packed exactly it.
			expect(packed, "packages the timeout budget assumed").toEqual(PACKED);
			expect(consumers).toBeGreaterThan(0);

			const suffix = ` via ${CARRIER} ${pluginVersion}`;
			for (const { manager, provenance, version, probe, cliLinkedAtTopLevel } of outcomes) {
				expect(version.exitCode, `${manager}: vitest-agent --version\n${version.stderr}`).toBe(0);
				expect(version.stdout, manager).toMatch(/\d+\.\d+\.\d+/);
				if (manager === "pnpm") {
					// pnpm writes a shell shim, not a symlink: no provenance to read.
					expect(provenance, "pnpm: a shell-shim .bin entry").toBeUndefined();
					// Isolated layout: only the consumer's direct dependency (the
					// carrier) is linked at the top level, so the bin that ran is the
					// carrier's shim, not a hoisted @vitest-agent/cli one.
					expect(cliLinkedAtTopLevel, "pnpm: @vitest-agent/cli must not be linked at the top level").toBe(false);
					expect(version.stdout, "pnpm: --version names the carrier").toContain(suffix);
				} else if (provenance?.package === CARRIER) {
					expect(version.stdout, `${manager}: the carrier's shim names the carrier`).toContain(suffix);
				} else {
					// A flat layout linked the hoisted front-end bin over the carrier's
					// shim: the same main(), minus the carrier identity. Anything but
					// the carrier or the cli fails here.
					expect(provenance?.package, `${manager}: vitest-agent bin owner`).toBe("@vitest-agent/cli");
					expect(version.stdout, `${manager}: the cli bin carries no carrier suffix`).not.toContain(" via ");
				}
				expect(probe.response.error, `${manager}: initialize answered an error`).toBeUndefined();
				expect(probe.stderr, `${manager}: vitest-agent-mcp stderr`).toBe("");
				expect(probe.exitCode, `${manager}: vitest-agent-mcp exit code`).toBe(0);
			}
		},
		TEST_TIMEOUT_MS,
	);
});
