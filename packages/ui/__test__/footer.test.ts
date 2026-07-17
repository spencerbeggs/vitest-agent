import type { DispatchInputs, FailureRecord, RenderState } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { buildFooter, dominantClassification } from "../src/dispatcher/footer.js";
import { belowTargetFixture } from "./utils/workspace.js";

const stateWithFailure = (classification: FailureRecord["classification"]): RenderState => ({
	...initialRenderState,
	phase: "finished",
	failures: [
		{
			modulePath: "src/x.test.ts",
			testName: "fails",
			suitePath: ["x"],
			error: { message: "boom" },
			classification,
		},
	],
});

const baseInputs = (overrides: Partial<DispatchInputs> = {}): DispatchInputs => ({
	state: initialRenderState,
	shape: "workspace",
	outcome: "all-pass",
	projects: [],
	trend: null,
	belowTarget: [],
	runCommand: null,
	...overrides,
});

describe("buildFooter — outcome-to-pointer mapping", () => {
	it("emits the file_coverage pointer when all-pass and below-target list is populated", () => {
		const footer = buildFooter(baseInputs({ outcome: "all-pass", belowTarget: belowTargetFixture }));
		expect(footer).toContain("Use `file_coverage` to find uncovered functions.");
	});

	it("emits nothing when all-pass and no below-target gap exists", () => {
		expect(buildFooter(baseInputs({ outcome: "all-pass" }))).toBe("");
	});

	it("emits the test_errors pointer for new-failure", () => {
		const inputs = baseInputs({ outcome: "some-fail", state: stateWithFailure("new-failure") });
		expect(buildFooter(inputs)).toContain("Use `test_errors` for failure detail");
	});

	it("emits the test_errors pointer for persistent", () => {
		const inputs = baseInputs({ outcome: "some-fail", state: stateWithFailure("persistent") });
		expect(buildFooter(inputs)).toContain("Use `test_errors` for failure detail");
	});

	it("emits the failure_signature_get pointer for flaky", () => {
		const inputs = baseInputs({ outcome: "some-fail", state: stateWithFailure("flaky") });
		expect(buildFooter(inputs)).toContain("Use `failure_signature_get` to confirm the flakiness signature.");
	});

	it("emits nothing for some-fail with recovered classification", () => {
		const inputs = baseInputs({ outcome: "some-fail", state: stateWithFailure("recovered") });
		expect(buildFooter(inputs)).toBe("");
	});

	it("emits nothing for some-fail with null classification", () => {
		const inputs = baseInputs({ outcome: "some-fail", state: stateWithFailure(null) });
		expect(buildFooter(inputs)).toBe("");
	});

	it("emits the test_coverage pointer for threshold-violation", () => {
		expect(buildFooter(baseInputs({ outcome: "threshold-violation" }))).toContain(
			"Use `test_coverage` for the workspace coverage breakdown.",
		);
	});

	it("starts with a leading newline so cells append without crafting their own separator", () => {
		const footer = buildFooter(baseInputs({ outcome: "threshold-violation" }));
		expect(footer.startsWith("\n")).toBe(true);
	});

	it("ends with a trailing newline so the footer is its own paragraph", () => {
		const footer = buildFooter(baseInputs({ outcome: "threshold-violation" }));
		expect(footer.endsWith("\n")).toBe(true);
	});
});

describe("dominantClassification — priority order", () => {
	it("returns null for an empty failure list", () => {
		expect(dominantClassification(initialRenderState)).toBe(null);
	});

	it("returns null when every failure is unclassified", () => {
		expect(dominantClassification(stateWithFailure(null))).toBe(null);
	});

	it("picks new-failure over flaky when both are present", () => {
		const state: RenderState = {
			...initialRenderState,
			failures: [
				{ modulePath: "a", testName: "x", suitePath: [], classification: "flaky" },
				{ modulePath: "b", testName: "y", suitePath: [], classification: "new-failure" },
			],
		};
		expect(dominantClassification(state)).toBe("new-failure");
	});

	it("picks persistent over flaky", () => {
		const state: RenderState = {
			...initialRenderState,
			failures: [
				{ modulePath: "a", testName: "x", suitePath: [], classification: "flaky" },
				{ modulePath: "b", testName: "y", suitePath: [], classification: "persistent" },
			],
		};
		expect(dominantClassification(state)).toBe("persistent");
	});

	it("picks flaky over recovered", () => {
		const state: RenderState = {
			...initialRenderState,
			failures: [
				{ modulePath: "a", testName: "x", suitePath: [], classification: "recovered" },
				{ modulePath: "b", testName: "y", suitePath: [], classification: "flaky" },
			],
		};
		expect(dominantClassification(state)).toBe("flaky");
	});
});
