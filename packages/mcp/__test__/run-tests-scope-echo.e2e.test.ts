/**
 * `run_tests` echoes the resolved scope (files, project, tags) it
 * actually used on a successful run (issue #200). Before this, `RunTestsOk`
 * echoed only `project` — an agent that believed a call was scoped to one
 * file (e.g. a dropped/misspelled param) had no way to tell from the
 * success payload that the run actually covered everything.
 *
 * `.e2e.test.ts`: runs a real nested Vitest instance in-process against a
 * tiny isolated fixture project — see `run-tests-console-leaks.e2e.test.ts`
 * for the same pattern.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { test } from "./integration/utils/fixtures.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "console-leak-project");
let xdgDir: string;

beforeAll(() => {
	xdgDir = mkdtempSync(join(tmpdir(), "va-run-tests-scope-xdg-"));
	process.env.XDG_DATA_HOME = xdgDir;
});

afterAll(() => {
	delete process.env.XDG_DATA_HOME;
	rmSync(xdgDir, { recursive: true, force: true });
});

const makeCaller = (runtime: unknown) =>
	createCallerFactory(appRouter)({
		runtime: runtime as McpContext["runtime"],
		cwd: fixtureDir,
		currentSessionId: createCurrentSessionIdRef(null),
		sessionContext: createSessionContextRef(),
	});

describe("run_tests echoes the resolved scope on success (e2e)", () => {
	test("an unfiltered run echoes an empty scope", { timeout: 120_000 }, async ({ runtime }) => {
		const caller = makeCaller(runtime);
		const result = await caller.run_tests({});

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.scope).toEqual({ project: null, files: [], tags: null });
	});

	test("a files-scoped run echoes the resolved files back", { timeout: 120_000 }, async ({ runtime }) => {
		const caller = makeCaller(runtime);
		const result = await caller.run_tests({ files: ["leaky.test.ts"] });

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.scope).toEqual({ project: null, files: ["leaky.test.ts"], tags: null });
	});
});
