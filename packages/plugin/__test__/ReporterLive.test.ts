import { DataStore, HistoryTracker, OutputRenderer } from "@vitest-agent/sdk";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ReporterLive } from "../src/layers/ReporterLive.js";
import { CoverageAnalyzer } from "../src/services/CoverageAnalyzer.js";

describe("ReporterLive", () => {
	it("provides DataStore", async () => {
		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(DataStore, () => Effect.succeed("ok")),
				ReporterLive(":memory:"),
			),
		);
		expect(result).toBe("ok");
	});

	it("provides CoverageAnalyzer", async () => {
		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(CoverageAnalyzer, () => Effect.succeed("ok")),
				ReporterLive(":memory:"),
			),
		);
		expect(result).toBe("ok");
	});

	it("provides HistoryTracker", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const tracker = yield* HistoryTracker;
				return tracker;
			}).pipe(Effect.provide(ReporterLive(":memory:"))),
		);
		expect(result).toBeDefined();
		expect(result.classify).toBeTypeOf("function");
	});

	it("provides OutputRenderer", async () => {
		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(OutputRenderer, () => Effect.succeed("ok")),
				ReporterLive(":memory:"),
			),
		);
		expect(result).toBe("ok");
	});
});
