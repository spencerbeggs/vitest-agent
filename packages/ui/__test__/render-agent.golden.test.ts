import { describe, expect, it } from "vitest";
import { reduceRenderStateAll, renderAgent } from "../src/index.js";
import { allPassEvents, coverageViolationEvents, flakyRecoveryEvents, mixedFailEvents } from "./fixtures/events.js";

describe("renderAgent — golden fixtures", () => {
	it("all-pass", async () => {
		const output = renderAgent(reduceRenderStateAll(allPassEvents));
		await expect(output).toMatchFileSnapshot("./snapshots/render-agent/all-pass.txt");
	});

	it("mixed-fail", async () => {
		const output = renderAgent(reduceRenderStateAll(mixedFailEvents));
		await expect(output).toMatchFileSnapshot("./snapshots/render-agent/mixed-fail.txt");
	});

	it("coverage-violation", async () => {
		const output = renderAgent(reduceRenderStateAll(coverageViolationEvents));
		await expect(output).toMatchFileSnapshot("./snapshots/render-agent/coverage-violation.txt");
	});

	it("flaky-recovery", async () => {
		const output = renderAgent(reduceRenderStateAll(flakyRecoveryEvents));
		await expect(output).toMatchFileSnapshot("./snapshots/render-agent/flaky-recovery.txt");
	});

	it("golden output is stable across repeat renders", () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		const first = renderAgent(state);
		const second = renderAgent(state);
		expect(first).toBe(second);
	});
});
