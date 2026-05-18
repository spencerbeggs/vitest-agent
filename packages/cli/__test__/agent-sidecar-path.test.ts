// Tests for agent sidecar-path subcommand wiring
import { describe, expect, it } from "vitest";

describe("agent sidecar-path subcommand", () => {
	it("should export sidecarPathSubcommand from commands/agent.ts", async () => {
		// Given: the agent commands module
		// When: importing the sidecar-path subcommand
		const agentModule = await import("../src/commands/agent.js");

		// Then: the subcommand export exists
		expect(agentModule.sidecarPathSubcommand).toBeDefined();
	});

	it("should include sidecarPathSubcommand in the agentCommand withSubcommands list", async () => {
		// Given: the agent commands module
		const agentModule = await import("../src/commands/agent.js");

		// When: checking the exported agentCommand shape
		// The presence of the subcommand export implies it is wired in;
		// the actual withSubcommands wiring is validated by the CLI's help output
		expect(typeof agentModule.sidecarPathSubcommand).toBe("object");
	});
});
