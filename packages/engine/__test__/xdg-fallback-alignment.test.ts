/**
 * Issue #422: with `XDG_DATA_HOME` unset, the reporter/MCP route
 * (`resolveDataPath` over `PathResolutionLive`) and the hook/sidecar route
 * (`resolveHookPaths`) must land in the same directory.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ConfigProvider, Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathResolutionLive } from "../src/layers/PathResolutionLive.js";
import { resolveHookPaths } from "../src/programs/hook-paths.js";
import { resolveDataPath } from "../src/utils/resolve-data-path.js";

let home: string;
let cwd: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "vitest-agent-home-"));
	cwd = mkdtempSync(join(tmpdir(), "vitest-agent-cwd-"));
	writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@org/pkg" }), "utf-8");
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

describe("XDG fallback alignment", () => {
	it("should resolve resolveDataPath and resolveHookPaths to the same directory under $HOME/.local/share/vitest-agent when XDG_DATA_HOME is unset", async () => {
		// Given: HOME points at a scratch dir and XDG_DATA_HOME is unset
		const env = { HOME: home };
		const EnvLive = ConfigProvider.layer(ConfigProvider.fromEnvRecord(env));
		const Deps = PathResolutionLive(cwd).pipe(Layer.provide(EnvLive), Layer.provideMerge(NodeServices.layer));

		// When: both routes resolve
		const dataPath = await Effect.runPromise(
			resolveDataPath(cwd).pipe(Effect.provide(Deps)) as Effect.Effect<string, unknown, never>,
		);
		const hookPaths = await Effect.runPromise(
			resolveHookPaths({ env, projectKey: "@org__pkg" }).pipe(Effect.provide(NodeServices.layer)),
		);

		// Then: they agree, under the XDG spec default
		expect(dirname(dataPath)).toBe(hookPaths.projectDataDir);
		expect(dirname(dataPath)).toBe(join(home, ".local", "share", "vitest-agent", "@org__pkg"));
	});
});
