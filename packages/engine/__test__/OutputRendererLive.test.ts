import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { OutputRendererLive } from "../src/layers/OutputRendererLive.js";
import { OutputRenderer } from "../src/services/OutputRenderer.js";

const run = <A, E>(effect: Effect.Effect<A, E, OutputRenderer>) =>
	Effect.runPromise(Effect.provide(effect, OutputRendererLive));

const minimalReport = {
	timestamp: new Date().toISOString(),
	reason: "passed" as const,
	summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 100 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
};

describe("OutputRendererLive", () => {
	it("renders markdown format", async () => {
		const outputs = await run(
			Effect.flatMap(OutputRenderer, (r) =>
				r.render([minimalReport], "markdown", {
					detail: "verbose",
					noColor: true,
					coverageConsoleLimit: 10,
				}),
			),
		);
		expect(outputs.length).toBeGreaterThan(0);
		expect(outputs[0].target).toBe("stdout");
	});

	it("renders json format", async () => {
		const outputs = await run(
			Effect.flatMap(OutputRenderer, (r) =>
				r.render([minimalReport], "json", {
					detail: "verbose",
					noColor: true,
					coverageConsoleLimit: 10,
				}),
			),
		);
		expect(outputs.length).toBe(1);
		expect(outputs[0].contentType).toBe("application/json");
	});

	it("renders silent format as empty", async () => {
		const outputs = await run(
			Effect.flatMap(OutputRenderer, (r) =>
				r.render([minimalReport], "silent", {
					detail: "verbose",
					noColor: true,
					coverageConsoleLimit: 10,
				}),
			),
		);
		expect(outputs).toHaveLength(0);
	});

	it("renders vitest-bypass as empty (defers to Vitest)", async () => {
		const outputs = await run(
			Effect.flatMap(OutputRenderer, (r) =>
				r.render([minimalReport], "vitest-bypass", {
					detail: "verbose",
					noColor: true,
					coverageConsoleLimit: 10,
				}),
			),
		);
		expect(outputs).toHaveLength(0);
	});
});
