import { describe, expect, it } from "vitest";
import { AgentPlugin } from "../src/plugin.js";

describe("AgentPlugin.COVERAGE_AUTOUPDATE", () => {
	it("standard floors the new threshold and ignores the previous one", () => {
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.standard(87.9, 95)).toBe(87);
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.standard(87.9, 10)).toBe(87);
	});

	it("strict ceils the new threshold and ignores the previous one", () => {
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.strict(87.1, 95)).toBe(88);
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.strict(87.1, 10)).toBe(88);
	});

	it("lenient subtracts a two point buffer when coverage rises", () => {
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.lenient(90.4, 70)).toBe(88);
	});

	it("lenient never ratchets below the previous threshold", () => {
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.lenient(70, 85)).toBe(85);
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.lenient(0, 60)).toBe(60);
	});

	it("lenient clamps at zero and tolerates a missing previous threshold", () => {
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.lenient(1, 0)).toBe(0);
		expect((AgentPlugin.COVERAGE_AUTOUPDATE.lenient as (n: number, p?: number) => number)(90.4)).toBe(88);
	});

	it("every tolerance function declares two parameters", () => {
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.standard.length).toBe(2);
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.strict.length).toBe(2);
		expect(AgentPlugin.COVERAGE_AUTOUPDATE.lenient.length).toBe(2);
	});
});
