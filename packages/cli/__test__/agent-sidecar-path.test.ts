// Tests for the agent sidecar-path subcommand export
import { describe, expect, it } from "vitest";

describe("agent sidecar-path subcommand", () => {
	it("should export sidecarPathSubcommand from commands/agent.ts", async () => {
		// Given: the agent commands module
		// When: importing the sidecar-path subcommand
		const agentModule = await import("../src/commands/agent.js");

		// Then: the subcommand export exists
		expect(agentModule.sidecarPathSubcommand).toBeDefined();
	});
});
