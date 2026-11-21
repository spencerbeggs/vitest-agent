import { DataReader } from "@vitest-agent/engine";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { handleCacheHealth } from "../src/tools/cache-health.js";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";
const UPDATED_MS = Date.parse(UPDATED_AT);
const HOUR = 60 * 60 * 1000;

const reader = Layer.succeed(
	DataReader,
	DataReader.of({
		getManifest: () => Effect.succeed(Option.some({ updatedAt: UPDATED_AT, cacheDir: "/db", projects: [] })),
	} as unknown as DataReader["Service"]),
);

/** `cache_health` with the clock set `ageMs` after the manifest's last update. */
const healthAt = (ageMs: number) =>
	Effect.runPromise(
		Effect.gen(function* () {
			yield* TestClock.setTime(UPDATED_MS + ageMs);
			return yield* handleCacheHealth();
		}).pipe(Effect.provide(Layer.merge(reader, TestClock.layer()))),
	);

describe("cache_health staleness reads the Effect Clock", () => {
	it("reports the manifest's age from the clock, fresh under a day", async () => {
		const result = await healthAt(23 * HOUR);
		expect(result).toMatchObject({ manifestPresent: true, ageMs: 23 * HOUR, stale: false });
	});

	it("reports a manifest older than a day as stale", async () => {
		const result = await healthAt(25 * HOUR);
		expect(result).toMatchObject({ manifestPresent: true, ageMs: 25 * HOUR, stale: true });
	});
});
