import { DataReader } from "@vitest-agent/sdk";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";

const waitForSchedulingTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

const makeGate = (): { readonly wait: Promise<void>; readonly release: () => void } => {
	let release: () => void = () => {};
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { wait, release };
};

const createTestCaller = (reader: DataReader["Service"]) => {
	const runtime = ManagedRuntime.make(Layer.succeed(DataReader, DataReader.of(reader)));
	const caller = createCallerFactory(appRouter)({
		runtime: runtime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	});
	return { caller, runtime };
};

describe("MCP tool Effect concurrency", () => {
	it("test_overview starts independent reads in parallel", async () => {
		const gate = makeGate();
		let manifestStarted = false;
		let runsStarted = false;
		const { caller, runtime } = createTestCaller({
			getManifest: () =>
				Effect.promise(async () => {
					manifestStarted = true;
					await gate.wait;
					return Option.none();
				}),
			getRunsByProject: () =>
				Effect.promise(async () => {
					runsStarted = true;
					await gate.wait;
					return [];
				}),
		} as unknown as DataReader["Service"]);

		const pending = caller.test_overview({});
		try {
			await waitForSchedulingTurn();
			expect(manifestStarted).toBe(true);
			expect(runsStarted).toBe(true);

			gate.release();
			const result = await pending;
			expect(result.dataAvailable).toBe(false);
		} finally {
			gate.release();
			await pending.catch(() => undefined);
			await runtime.dispose();
		}
	});

	it("test_history starts history, flaky, and persistent reads in parallel", async () => {
		const gate = makeGate();
		let historyStarted = false;
		let flakyStarted = false;
		let persistentStarted = false;
		const { caller, runtime } = createTestCaller({
			getHistory: () =>
				Effect.promise(async () => {
					historyStarted = true;
					await gate.wait;
					return {
						project: "parallel-project",
						updatedAt: "2026-08-28T00:00:00.000Z",
						tests: [],
					};
				}),
			getFlaky: () =>
				Effect.promise(async () => {
					flakyStarted = true;
					await gate.wait;
					return [];
				}),
			getPersistentFailures: () =>
				Effect.promise(async () => {
					persistentStarted = true;
					await gate.wait;
					return [];
				}),
		} as unknown as DataReader["Service"]);

		const pending = caller.test_history({ project: "parallel-project" });
		try {
			await waitForSchedulingTurn();
			expect(historyStarted).toBe(true);
			expect(flakyStarted).toBe(true);
			expect(persistentStarted).toBe(true);

			gate.release();
			const result = await pending;
			expect(result.hasData).toBe(false);
			expect(result.history.tests).toHaveLength(0);
			expect(result.flaky).toHaveLength(0);
			expect(result.persistent).toHaveLength(0);
		} finally {
			gate.release();
			await pending.catch(() => undefined);
			await runtime.dispose();
		}
	});
});
