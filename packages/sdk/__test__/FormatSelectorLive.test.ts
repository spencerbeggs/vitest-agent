import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { FormatSelectorLive } from "../src/layers/FormatSelectorLive.js";
import { FormatSelector } from "../src/services/FormatSelector.js";

const run = <A, E>(effect: Effect.Effect<A, E, FormatSelector>) =>
	Effect.runPromise(Effect.provide(effect, FormatSelectorLive));

describe("FormatSelectorLive", () => {
	it("agent -> terminal by default (plain text + ANSI for stdout)", async () => {
		const result = await run(Effect.flatMap(FormatSelector, (s) => s.select("agent")));
		expect(result).toBe("terminal");
	});

	it("human -> silent by default", async () => {
		const result = await run(Effect.flatMap(FormatSelector, (s) => s.select("human")));
		expect(result).toBe("silent");
	});

	it("ci -> terminal by default (when not GitHub Actions)", async () => {
		const result = await run(Effect.flatMap(FormatSelector, (s) => s.select("ci")));
		expect(result).toBe("terminal");
	});

	it("ci + ci-github -> ci-annotations", async () => {
		const result = await run(Effect.flatMap(FormatSelector, (s) => s.select("ci", undefined, "ci-github")));
		expect(result).toBe("ci-annotations");
	});

	it("explicit format overrides default", async () => {
		const result = await run(Effect.flatMap(FormatSelector, (s) => s.select("human", "json")));
		expect(result).toBe("json");
	});

	it("vitest-bypass returns vitest-bypass", async () => {
		const result = await run(Effect.flatMap(FormatSelector, (s) => s.select("agent", "vitest-bypass")));
		expect(result).toBe("vitest-bypass");
	});
});
