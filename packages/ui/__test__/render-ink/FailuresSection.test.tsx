import type { FailureRecord } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { FailuresSection } from "../../src/render-ink/FailuresSection.js";
import { renderInk } from "../utils/render-ink.js";

const fail = (over: Partial<FailureRecord>): FailureRecord => ({
	modulePath: "cli/inject.test.ts",
	testName: "rewrites the command",
	suitePath: ["injectEnv"],
	classification: null,
	...over,
});

describe("FailuresSection", () => {
	it("renders a header with the count and one entry per failure", () => {
		const { frame, cleanup } = renderInk(
			<FailuresSection
				failures={[
					fail({ error: { message: "AssertionError: expected x to be y" } }),
					fail({ testName: "resolves absolute path", error: { message: "Error: ENOENT" } }),
				]}
				limit={5}
			/>,
			80,
		);
		expect(frame).toContain("Failures (2):");
		expect(frame).toContain("rewrites the command");
		expect(frame).toContain("AssertionError: expected x to be y");
		cleanup();
	});

	it("caps the list and shows an overflow line", () => {
		const failures = Array.from({ length: 7 }, (_, i) => fail({ testName: `failure ${i}` }));
		const { frame, cleanup } = renderInk(<FailuresSection failures={failures} limit={3} />, 80);
		expect(frame).toContain("failure 0");
		expect(frame).toContain("failure 2");
		expect(frame).not.toContain("failure 3");
		expect(frame).toContain("… 4 more");
		cleanup();
	});

	it("marks a timed-out failure with the timeout glyph", () => {
		const { frame, cleanup } = renderInk(
			<FailuresSection
				failures={[fail({ timedOut: true, error: { message: "Test timed out in 5000ms" } })]}
				limit={5}
			/>,
			80,
		);
		expect(frame).toContain("⧖");
		cleanup();
	});

	it("renders expected: and received: lines when the error carries structured values", () => {
		const { frame, cleanup } = renderInk(
			<FailuresSection
				failures={[
					fail({
						error: {
							message: "AssertionError: expected 3 to be 4",
							expected: "4",
							received: "3",
						},
					}),
				]}
				limit={5}
			/>,
			80,
		);
		expect(frame).toContain("expected: 4");
		expect(frame).toContain("received: 3");
		cleanup();
	});

	it("omits expected/received lines when the error has no structured values", () => {
		const { frame, cleanup } = renderInk(
			<FailuresSection failures={[fail({ error: { message: "Error: something went wrong" } })]} limit={5} />,
			80,
		);
		expect(frame).not.toContain("expected:");
		expect(frame).not.toContain("received:");
		cleanup();
	});
});
