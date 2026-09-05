/**
 * Issue #320: `run_tests`'s timeout implementation raced a `setTimeout`
 * against `localVitest.start(...)` and signaled the timeout by rejecting
 * with `new Error("VITEST_TIMEOUT")`, then classified the catch block
 * purely on `err.message === "VITEST_TIMEOUT"`. A string sentinel like
 * this collides with an ordinary error that happens to carry the exact
 * same message — such an error is misreported as `{ kind: "timeout" }`
 * instead of `{ kind: "error" }`.
 *
 * Seam: `vitestLoader.load` is substituted directly (see
 * `run-tests-project-root.test.ts` for why `vi.mock("vitest/node", ...)`
 * does not work here — issue #303).
 */

import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { DataStoreTestLayer } from "@vitest-agent/sdk/testing";
import { Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { vitestLoader } from "../src/tools/run-tests.js";

const createVitestMock = vi.fn();

const { appRouter } = await import("../src/router.js");

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));

describe("run_tests timeout classification (issue #320)", () => {
	let runtime: ManagedRuntime.ManagedRuntime<never, never>;

	const originalVitestLoad = vitestLoader.load;

	beforeEach(() => {
		runtime = ManagedRuntime.make(TestLayer) as unknown as ManagedRuntime.ManagedRuntime<never, never>;
		createVitestMock.mockReset();
		vitestLoader.load = (async () => ({
			createVitest: (...innerArgs: unknown[]) => createVitestMock(...innerArgs),
		})) as unknown as typeof vitestLoader.load;
	});

	afterEach(async () => {
		await runtime.dispose();
		vitestLoader.load = originalVitestLoad;
	});

	const makeCaller = () =>
		createCallerFactory(appRouter)({
			runtime: runtime as unknown as McpContext["runtime"],
			cwd: process.cwd(),
			currentSessionId: createCurrentSessionIdRef(null),
			sessionContext: createSessionContextRef(),
		});

	it('reports { kind: "error" }, not { kind: "timeout" }, when an ordinary thrown error\'s message happens to be the literal string VITEST_TIMEOUT', async () => {
		createVitestMock.mockResolvedValue({
			start: vi.fn(async () => {
				throw new Error("VITEST_TIMEOUT");
			}),
			state: { getFiles: () => [] },
			close: vi.fn(async () => undefined),
		});

		const caller = makeCaller();
		const result = await caller.run_tests({ timeout: 30 });

		expect(result.kind).toBe("error");
		if (result.kind !== "error") return;
		expect(result.message).toContain("VITEST_TIMEOUT");
	});

	it('still reports { kind: "timeout" } when the run genuinely exceeds the configured timeout', async () => {
		createVitestMock.mockResolvedValue({
			// Never resolves — the real timeout race must fire.
			start: vi.fn(() => new Promise(() => undefined)),
			state: { getFiles: () => [] },
			close: vi.fn(async () => undefined),
		});

		const caller = makeCaller();
		const result = await caller.run_tests({ timeout: 0.05 });

		expect(result.kind).toBe("timeout");
		if (result.kind !== "timeout") return;
		expect(result.timeoutSeconds).toBe(0.05);
	});
});
