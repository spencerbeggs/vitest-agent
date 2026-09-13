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

import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import { Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vitestLoader } from "../src/tools/run-tests.js";
import { makeCaller } from "./utils/caller.js";

const createVitestMock = vi.fn();

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive(process.env), ProjectDiscoveryTest.layer([]));

describe("run_tests timeout classification (issue #320)", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Layer.Success<typeof TestLayer>, Layer.Error<typeof TestLayer>>;

	const originalVitestLoad = vitestLoader.load;

	beforeEach(() => {
		runtime = ManagedRuntime.make(TestLayer);
		createVitestMock.mockReset();
		vitestLoader.load = (async () => ({
			createVitest: (...innerArgs: unknown[]) => createVitestMock(...innerArgs),
		})) as unknown as typeof vitestLoader.load;
	});

	afterEach(async () => {
		await runtime.dispose();
		vitestLoader.load = originalVitestLoad;
	});

	const runTests = (params: { timeout: number }) => makeCaller(runtime)("run_tests", params);

	it('reports { kind: "error" }, not { kind: "timeout" }, when an ordinary thrown error\'s message happens to be the literal string VITEST_TIMEOUT', async () => {
		createVitestMock.mockResolvedValue({
			start: vi.fn(async () => {
				throw new Error("VITEST_TIMEOUT");
			}),
			state: { getFiles: () => [] },
			close: vi.fn(async () => undefined),
		});

		const result = await runTests({ timeout: 30 });

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

		const result = await runTests({ timeout: 0.05 });

		expect(result.kind).toBe("timeout");
		if (result.kind !== "timeout") return;
		expect(result.timeoutSeconds).toBe(0.05);
	});
});
