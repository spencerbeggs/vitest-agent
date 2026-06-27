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
	// Isolate AgentPlugin DB writes into a throwaway XDG dir so the fixture
	// run does not collide with the monorepo's own data.db.
	xdgDir = mkdtempSync(join(tmpdir(), "va-leak-xdg-"));
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

describe("run_tests folds console leaks into the report under the real reporter topology (e2e)", () => {
	test("a leaking passing test surfaces consoleLeaks with attribution and sample", { timeout: 120_000 }, async ({
		runtime,
	}) => {
		const caller = makeCaller(runtime);
		const result = await caller.run_tests({});

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;

		const leaks = result.report.consoleLeaks;
		expect(leaks).toBeDefined();
		expect(leaks?.total).toBe(2);

		const file = leaks?.byFile.find((f) => f.file.endsWith("leaky.test.ts"));
		expect(file).toBeDefined();
		expect(file?.stdout).toBe(1);
		expect(file?.stderr).toBe(1);
		expect(file?.tests).toContain("leaks when fetching");
		expect(file?.sample).toContain("DEBUG cache miss for key abc");
	});
});
