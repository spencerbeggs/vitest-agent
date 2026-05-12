import { describe, expect, it } from "vitest";
import { App, reduceRenderStateAll } from "../../src/index.js";
import { allPassEvents, coverageViolationEvents, flakyRecoveryEvents, mixedFailEvents } from "../fixtures/events.js";
import { renderInk } from "../utils/render-ink.js";

describe("App — golden integration", () => {
	it("renders the all-pass fixture", async () => {
		const state = reduceRenderStateAll(allPassEvents);
		const { frame, cleanup } = renderInk(<App state={state} />);
		await expect(frame).toMatchFileSnapshot("../snapshots/render-ink/all-pass.txt");
		cleanup();
	});

	it("renders the mixed-fail fixture", async () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		const { frame, cleanup } = renderInk(<App state={state} />);
		await expect(frame).toMatchFileSnapshot("../snapshots/render-ink/mixed-fail.txt");
		cleanup();
	});

	it("renders the coverage-violation fixture", async () => {
		const state = reduceRenderStateAll(coverageViolationEvents);
		const { frame, cleanup } = renderInk(<App state={state} />);
		await expect(frame).toMatchFileSnapshot("../snapshots/render-ink/coverage-violation.txt");
		cleanup();
	});

	it("renders the flaky-recovery fixture", async () => {
		const state = reduceRenderStateAll(flakyRecoveryEvents);
		const { frame, cleanup } = renderInk(<App state={state} />);
		await expect(frame).toMatchFileSnapshot("../snapshots/render-ink/flaky-recovery.txt");
		cleanup();
	});

	it("expands per-module tests when showModuleTests is true", async () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		const { frame, cleanup } = renderInk(<App state={state} options={{ showModuleTests: true }} />);
		await expect(frame).toMatchFileSnapshot("../snapshots/render-ink/mixed-fail-expanded.txt");
		cleanup();
	});
});
