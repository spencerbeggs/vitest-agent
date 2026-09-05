import { describe, expect, it } from "vitest";
import { detectNonDefaultDiscoverStrategy } from "../src/utils/detect-non-default-discover-strategy.js";

describe("detectNonDefaultDiscoverStrategy", () => {
	it("detects a discoverStrategy option key", () => {
		const source = `AgentPlugin({ console, discoverStrategy: myStrategy })`;
		expect(detectNonDefaultDiscoverStrategy(source)).toBe(true);
	});

	it("detects discoverStrategy: false", () => {
		const source = `AgentPlugin({ console, discoverStrategy: false })`;
		expect(detectNonDefaultDiscoverStrategy(source)).toBe(true);
	});

	it("detects an .addProject( call", () => {
		const source = `AgentPlugin.discover().addProject({ name: "integration", path: "./test-only" })`;
		expect(detectNonDefaultDiscoverStrategy(source)).toBe(true);
	});

	it("detects a class extending DefaultDiscoverStrategy", () => {
		const source = `class MyStrategy extends DefaultDiscoverStrategy {}`;
		expect(detectNonDefaultDiscoverStrategy(source)).toBe(true);
	});

	it("detects a class implementing DiscoverStrategy", () => {
		const source = `class MyStrategy implements DiscoverStrategy {}`;
		expect(detectNonDefaultDiscoverStrategy(source)).toBe(true);
	});

	it("returns false for a plain AgentPlugin config with no markers", () => {
		const source = `
			import { AgentPlugin } from "@vitest-agent/plugin";
			export default defineConfig({
				plugins: [AgentPlugin({ console, coverageTargets: AgentPlugin.COVERAGE_LEVELS.standard })],
			});
		`;
		expect(detectNonDefaultDiscoverStrategy(source)).toBe(false);
	});
});
