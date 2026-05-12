import { describe, expect, it } from "vitest";
import type { TestRecord } from "vitest-agent-sdk";
import { TestRow } from "../../src/render-ink/index.js";
import { renderInk } from "../utils/render-ink.js";

const testOf = (overrides: Partial<TestRecord> = {}): TestRecord => ({
	testName: "adds two numbers",
	suitePath: ["math"],
	status: "passed",
	durationMs: 4,
	...overrides,
});

describe("TestRow", () => {
	it("renders a passing test with suite path and duration", () => {
		const { frame, cleanup } = renderInk(<TestRow test={testOf()} />);
		expect(frame).toMatchInlineSnapshot(`"  ✓ math > adds two numbers (4ms)"`);
		cleanup();
	});

	it("renders a failing test in red", () => {
		const { frame, cleanup } = renderInk(<TestRow test={testOf({ status: "failed", durationMs: 7 })} />);
		expect(frame).toMatchInlineSnapshot(`"  ✗ math > adds two numbers (7ms)"`);
		cleanup();
	});

	it("renders a running test without a duration", () => {
		const { frame, cleanup } = renderInk(<TestRow test={testOf({ status: "running", durationMs: null })} />);
		expect(frame).toMatchInlineSnapshot(`"  … math > adds two numbers"`);
		cleanup();
	});

	it("renders a top-level test (no suite path) without a leading separator", () => {
		const { frame, cleanup } = renderInk(<TestRow test={testOf({ suitePath: [] })} />);
		expect(frame).toMatchInlineSnapshot(`"  ✓ adds two numbers (4ms)"`);
		cleanup();
	});

	it("supports a custom indent", () => {
		const { frame, cleanup } = renderInk(<TestRow test={testOf()} indent={4} />);
		expect(frame.startsWith("    ")).toBe(true);
		cleanup();
	});
});
