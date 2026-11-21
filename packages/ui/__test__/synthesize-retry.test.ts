import type { VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { synthesizeRunEvents } from "../src/index.js";

interface Attempt {
	readonly errors?: ReadonlyArray<{ message: string }>;
}

// A retried test: `result()` carries the stale first-attempt error (what the
// old `result.errors[0]` read), `attempts()` carries the per-attempt errors.
const makeRetriedModule = (
	state: "passed" | "failed",
	resultErrors: ReadonlyArray<{ message: string }>,
	attempts: ReadonlyArray<Attempt>,
): VitestTestModule => {
	const module: VitestTestModule = {
		type: "module",
		moduleId: "retry.test.ts",
		relativeModuleId: "retry.test.ts",
		project: { name: "default" },
		state: () => "passed",
		children: {
			*allTests() {
				const test: VitestTestCase = {
					type: "test",
					name: "retried",
					fullName: "retried",
					tags: [],
					parent: module,
					result: () => ({ state, errors: resultErrors }),
					attempts: () => attempts,
					diagnostic: () => ({ duration: 0, flaky: false, slow: false }),
				};
				yield test;
			},
			*allSuites() {
				// not used by synthesize
			},
		},
		diagnostic: () => ({ duration: 0 }),
		errors: () => [],
	};
	return module;
};

const TIMEOUT = { message: "Test timed out in 5000ms." };
const ASSERTION = { message: "expected 1 to equal 2" };

describe("synthesizeRunEvents retried tests", () => {
	it("reports the assertion error and not a timeout after a retried timeout", () => {
		const events = synthesizeRunEvents([
			makeRetriedModule("failed", [TIMEOUT], [{ errors: [TIMEOUT] }, { errors: [ASSERTION] }]),
		]);
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({ error: { message: ASSERTION.message } });
		expect(finished).not.toMatchObject({ timedOut: true });
	});

	it("synthesizes no error for a test that passed on retry", () => {
		const events = synthesizeRunEvents([makeRetriedModule("passed", [TIMEOUT], [{ errors: [TIMEOUT] }, {}])]);
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).not.toHaveProperty("error");
	});
});
