import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { DataStore, OutputPipelineLive, ProjectDiscoveryTest } from "vitest-agent-sdk";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { DataStoreTestLayer } from "./utils/layers.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));

function createTestCaller() {
	const runtime = ManagedRuntime.make(TestLayer);
	const factory = createCallerFactory(appRouter);
	const caller = factory({
		runtime: runtime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	});
	return { caller, runtime };
}

async function seedFailureSignature(
	runtime: ManagedRuntime.ManagedRuntime<DataStore, never>,
	hash: string,
): Promise<void> {
	await runtime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;

			yield* store.writeSettings("hash-fs-test", { vitestVersion: "3.2.0", pool: "forks", coverageProvider: "v8" }, {});
			const runId = yield* store.writeRun({
				invocationId: "inv-fs-001",
				project: "default",
				settingsHash: "hash-fs-test",
				timestamp: "2026-05-02T00:00:00.000Z",
				commitSha: null,
				branch: null,
				reason: "failed",
				duration: 100,
				total: 1,
				passed: 0,
				failed: 1,
				skipped: 0,
				scoped: false,
			});
			yield* store.writeFailureSignature({
				signatureHash: hash,
				runId,
				seenAt: "2026-05-02T00:00:00.000Z",
			});
		}),
	);
}

describe("failure_signature_get structured payload", () => {
	it("returns found=true with the matching signatureHash so callers preserve it under clipping", async () => {
		const { caller, runtime } = createTestCaller();
		try {
			const hash = "abc123def456cafe";
			await seedFailureSignature(runtime as unknown as ManagedRuntime.ManagedRuntime<DataStore, never>, hash);

			const result = await caller.failure_signature_get({ hash });

			expect(result.found).toBe(true);
			if (result.found) expect(result.signatureHash).toBe(hash);
		} finally {
			await runtime.dispose();
		}
	});
});
