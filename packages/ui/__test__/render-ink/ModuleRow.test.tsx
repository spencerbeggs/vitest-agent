import { describe, expect, it } from "vitest";
import type { ModuleRecord } from "vitest-agent-sdk";
import { ModuleRow } from "../../src/render-ink/index.js";
import { renderInk } from "../utils/render-ink.js";

const moduleWithTests: ModuleRecord = {
	modulePath: "src/math.test.ts",
	status: "finished",
	passCount: 2,
	failCount: 1,
	skipCount: 0,
	durationMs: 18,
	tests: [
		{ testName: "adds", suitePath: ["math"], status: "passed", durationMs: 2 },
		{ testName: "divides", suitePath: ["math"], status: "failed", durationMs: 5 },
		{ testName: "subtracts", suitePath: ["math"], status: "passed", durationMs: 11 },
	],
};

describe("ModuleRow", () => {
	it("renders only the header by default", () => {
		const { frame, cleanup } = renderInk(<ModuleRow module={moduleWithTests} />);
		expect(frame).toMatchInlineSnapshot(`"✗ src/math.test.ts (2 passed, 1 failed, 18ms)"`);
		cleanup();
	});

	it("renders the header plus every test when showTests is true", () => {
		const { frame, cleanup } = renderInk(<ModuleRow module={moduleWithTests} showTests />);
		expect(frame).toMatchInlineSnapshot(`
			"✗ src/math.test.ts (2 passed, 1 failed, 18ms)
			  ✓ math > adds (2ms)
			  ✗ math > divides (5ms)
			  ✓ math > subtracts (11ms)"
		`);
		cleanup();
	});
});
