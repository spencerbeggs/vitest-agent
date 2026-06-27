import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConsoleMode } from "../src/plugin.js";

const ENV = "VITEST_AGENT_CONSOLE";

describe("resolveConsoleMode VITEST_AGENT_CONSOLE override", () => {
	const original = process.env[ENV];
	beforeEach(() => {
		delete process.env[ENV];
	});
	afterEach(() => {
		if (original === undefined) delete process.env[ENV];
		else process.env[ENV] = original;
		vi.restoreAllMocks();
	});

	it("falls back to per-executor defaults when unset", () => {
		expect(resolveConsoleMode({}, "human", "terminal")).toBe("passthrough");
		expect(resolveConsoleMode({}, "agent", "agent-shell")).toBe("agent");
	});

	it("overrides config when set to a valid mode for the slot", () => {
		process.env[ENV] = "passthrough";
		// agent default is "agent"; the override forces passthrough.
		expect(resolveConsoleMode({ console: { agent: "silent" } }, "agent", "agent-shell")).toBe("passthrough");
	});

	it("honors silent override on the human slot", () => {
		process.env[ENV] = "silent";
		expect(resolveConsoleMode({}, "human", "terminal")).toBe("silent");
	});

	it("warns and ignores a value invalid for the active slot", () => {
		const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		process.env[ENV] = "stream"; // not valid for the agent slot
		expect(resolveConsoleMode({}, "agent", "agent-shell")).toBe("agent");
		expect(warn).toHaveBeenCalledOnce();
		expect(String(warn.mock.calls[0][0])).toContain("VITEST_AGENT_CONSOLE");
	});
});
