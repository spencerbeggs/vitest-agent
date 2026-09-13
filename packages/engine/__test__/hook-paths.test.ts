/**
 * `resolveHookPaths` / `resolveSessionMapPath` — the sidecar-family path
 * contract, resolved from an injected env map (never `process.env`).
 *
 * Runs against an `@effected/memfs` volume so the "directory is created"
 * half of the contract is a real assertion: an unseeded path does not
 * exist until the resolver makes it.
 */

import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path } from "effect";
import { describe, expect, it } from "vitest";
import { resolveHookPaths, resolveSessionMapPath } from "../src/programs/hook-paths.js";

const Platform = Layer.mergeAll(MemoryFileSystem.layerWith({}), Path.layer);

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	Effect.runPromise(effect.pipe(Effect.provide(Platform)));

/** Resolve the paths and report which of them exist on the volume afterwards. */
const resolveAndProbe = (env: Record<string, string | undefined>, projectKey = "@org__pkg") =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const paths = yield* resolveHookPaths({ env, projectKey });
			const path = yield* Path.Path;
			return {
				paths,
				dataRootExists: yield* fs.exists(paths.dataRoot),
				projectDataDirExists: yield* fs.exists(paths.projectDataDir),
				sessionMapDirExists: yield* fs.exists(path.dirname(paths.sessionMapDbPath)),
			};
		}),
	);

describe("resolveHookPaths", () => {
	it("anchors the data root at $XDG_DATA_HOME/vitest-agent and creates every directory", async () => {
		const { paths, dataRootExists, projectDataDirExists, sessionMapDirExists } = await resolveAndProbe({
			HOME: "/home/u",
			XDG_DATA_HOME: "/xdg/data",
			CLAUDE_PLUGIN_DATA: "/plugin/data",
		});
		expect(paths).toEqual({
			dataRoot: "/xdg/data/vitest-agent",
			projectDataDir: "/xdg/data/vitest-agent/@org__pkg",
			perProjectDbPath: "/xdg/data/vitest-agent/@org__pkg/data.db",
			registryDbPath: "/xdg/data/vitest-agent/registry.db",
			sessionMapDbPath: "/plugin/data/sessions.db",
		});
		expect(dataRootExists).toBe(true);
		expect(projectDataDirExists).toBe(true);
		expect(sessionMapDirExists).toBe(true);
	});

	it("falls back to $HOME/.local/share/vitest-agent when XDG_DATA_HOME is unset or empty", async () => {
		const unset = await resolveAndProbe({ HOME: "/home/u" });
		expect(unset.paths.dataRoot).toBe("/home/u/.local/share/vitest-agent");
		expect(unset.paths.perProjectDbPath).toBe("/home/u/.local/share/vitest-agent/@org__pkg/data.db");
		const empty = await resolveAndProbe({ HOME: "/home/u", XDG_DATA_HOME: "" });
		expect(empty.paths.dataRoot).toBe("/home/u/.local/share/vitest-agent");
	});

	it("uses USERPROFILE as the home directory when HOME is unset", async () => {
		const { paths } = await resolveAndProbe({ USERPROFILE: "/Users/win" });
		expect(paths.dataRoot).toBe("/Users/win/.local/share/vitest-agent");
		expect(paths.sessionMapDbPath).toBe("/Users/win/.vitest-agent/sessions.db");
	});

	it("reads only the injected env map, never the ambient process environment", async () => {
		// The real process has HOME and XDG_DATA_HOME; an env map without a
		// home must still fail rather than borrow them.
		const exit = await Effect.runPromiseExit(
			resolveHookPaths({ env: {}, projectKey: "k" }).pipe(Effect.provide(Platform)),
		);
		expect(exit._tag).toBe("Failure");
	});
});

describe("resolveSessionMapPath", () => {
	const resolve = (env: Record<string, string | undefined>) => run(resolveSessionMapPath(env));

	it("prefers CLAUDE_PLUGIN_DATA over VITEST_AGENT_SESSION_MAP_DIR over the home fallback", async () => {
		await expect(
			resolve({ CLAUDE_PLUGIN_DATA: "/plugin", VITEST_AGENT_SESSION_MAP_DIR: "/override", HOME: "/home/u" }),
		).resolves.toBe("/plugin/sessions.db");
		await expect(resolve({ VITEST_AGENT_SESSION_MAP_DIR: "/override", HOME: "/home/u" })).resolves.toBe(
			"/override/sessions.db",
		);
		await expect(resolve({ HOME: "/home/u" })).resolves.toBe("/home/u/.vitest-agent/sessions.db");
	});

	it("treats an empty env var as unset at every rung", async () => {
		await expect(
			resolve({ CLAUDE_PLUGIN_DATA: "", VITEST_AGENT_SESSION_MAP_DIR: "", HOME: "", USERPROFILE: "/Users/win" }),
		).resolves.toBe("/Users/win/.vitest-agent/sessions.db");
	});

	it("fails with ProjectIdentityNotResolvableError naming every source when no home is resolvable", async () => {
		const error = await run(resolveSessionMapPath({}).pipe(Effect.flip));
		expect(error._tag).toBe("ProjectIdentityNotResolvableError");
		if (error._tag !== "ProjectIdentityNotResolvableError") throw new Error("unreachable");
		expect(error.tried.map((t) => t.source)).toEqual(["CLAUDE_PLUGIN_DATA", "VITEST_AGENT_SESSION_MAP_DIR", "HOME"]);
	});
});
