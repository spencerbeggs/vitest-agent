/**
 * Issue #625: the pure persistence decision behind `AgentPlugin({ persist })`
 * and the `VITEST_AGENT_PERSIST` operator override. The env var wins over the
 * option in both directions; an unrecognized value is ignored and reported.
 */

import { describe, expect, it } from "vitest";
import { resolvePersistence } from "../src/utils/resolve-persistence.js";

describe("resolvePersistence (#625)", () => {
	it("defaults to persisting when neither the option nor the env var is set", () => {
		expect(resolvePersistence({ option: undefined, env: {} })).toEqual({ persist: true, source: "default" });
	});

	it("honors persist: false from the option", () => {
		expect(resolvePersistence({ option: false, env: {} })).toEqual({ persist: false, source: "option" });
	});

	it("honors an explicit persist: true from the option", () => {
		expect(resolvePersistence({ option: true, env: {} })).toEqual({ persist: true, source: "option" });
	});

	it.each(["0", "false", "FALSE", "off", " False "])("env %j disables persistence over option true", (value) => {
		expect(resolvePersistence({ option: true, env: { VITEST_AGENT_PERSIST: value } })).toEqual({
			persist: false,
			source: "env",
		});
	});

	it.each(["1", "true", "TRUE", "on"])("env %j enables persistence over option false", (value) => {
		expect(resolvePersistence({ option: false, env: { VITEST_AGENT_PERSIST: value } })).toEqual({
			persist: true,
			source: "env",
		});
	});

	it("treats an empty env value as unset", () => {
		expect(resolvePersistence({ option: false, env: { VITEST_AGENT_PERSIST: "" } })).toEqual({
			persist: false,
			source: "option",
		});
	});

	it("ignores an unrecognized env value, falls through to the option, and reports it", () => {
		expect(resolvePersistence({ option: undefined, env: { VITEST_AGENT_PERSIST: "maybe" } })).toEqual({
			persist: true,
			source: "default",
			ignoredEnvValue: "maybe",
		});
	});

	it("does not react to CI=true on its own (the opt-out is explicit, never automatic)", () => {
		expect(resolvePersistence({ option: undefined, env: { CI: "true" } })).toEqual({
			persist: true,
			source: "default",
		});
	});
});
