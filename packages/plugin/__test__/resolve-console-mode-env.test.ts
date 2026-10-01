import { Audience } from "@effected/env";
import { AgentConsoleMode, CiConsoleMode, HumanConsoleMode } from "@vitest-agent/sdk";
import { ConfigProvider, Effect, Logger, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConsoleOverride, resolveConsoleMode } from "../src/plugin.js";

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
		expect(resolveConsoleMode({}, "ci", "ci-generic")).toBe("passthrough");
	});

	it("treats an empty value as unset", () => {
		process.env[ENV] = "";
		expect(resolveConsoleMode({ console: { agent: "silent" } }, "agent", "agent-shell")).toBe("silent");
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

	it("matches the override case-insensitively and yields the canonical literal", () => {
		process.env[ENV] = "CI-Annotations";
		expect(resolveConsoleMode({}, "ci", "ci-github")).toBe("ci-annotations");
	});

	it("warns on stderr, never stdout, and ignores a value invalid for the active slot", () => {
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		process.env[ENV] = "stream"; // not valid for the agent slot
		expect(resolveConsoleMode({}, "agent", "agent-shell")).toBe("agent");
		expect(stdout).not.toHaveBeenCalled();
		expect(stderr).toHaveBeenCalledOnce();
		const line = String(stderr.mock.calls[0]?.[0]);
		expect(line).toMatch(/^\[vitest-agent:plugin\] /);
		expect(line).toContain(`${ENV}=stream`);
		expect(line.endsWith("\n")).toBe(true);
	});

	it("routes the warning through the caller's report sink, not the process streams", () => {
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const lines: Array<string> = [];
		process.env[ENV] = "bogus";
		resolveConsoleMode({}, "human", "terminal", (line) => lines.push(line));
		expect(lines).toHaveLength(1);
		expect(stderr).not.toHaveBeenCalled();
		expect(stdout).not.toHaveBeenCalled();
	});

	it.each([
		{ executor: "human", env: "terminal", literals: HumanConsoleMode.literals } as const,
		{ executor: "agent", env: "agent-shell", literals: AgentConsoleMode.literals } as const,
		{ executor: "ci", env: "ci-generic", literals: CiConsoleMode.literals } as const,
	])(
		"names the accepted values for the $executor slot when the env override is invalid",
		({ executor, env, literals }) => {
			const lines: Array<string> = [];
			process.env[ENV] = "not-a-real-mode";
			resolveConsoleMode({}, executor, env, (line) => lines.push(line));
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain(`${executor} audience`);
			expect(lines[0]).toContain(literals.join("|"));
		},
	);
});

describe("readConsoleOverride", () => {
	const run = (kind: "human" | "agent" | "ci", env: Record<string, string>) => {
		const warnings: Array<unknown> = [];
		const result = Effect.runSync(
			readConsoleOverride.pipe(
				Effect.provide(Audience.layerTest(kind)),
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
				Effect.provide(Logger.layer([Logger.make(({ message }) => warnings.push(message))])),
			),
		);
		return { result, warnings };
	};

	it("accepts a literal only for the audience that lists it", () => {
		expect(run("human", { [ENV]: "stream" }).result).toEqual(Option.some("stream"));
		const agent = run("agent", { [ENV]: "stream" });
		expect(agent.result).toEqual(Option.none());
		expect(agent.warnings).toHaveLength(1);
	});

	it("is None without a warning when the variable is absent", () => {
		const { result, warnings } = run("ci", {});
		expect(result).toEqual(Option.none());
		expect(warnings).toHaveLength(0);
	});

	it("accepts ci-annotations only for the ci audience", () => {
		expect(run("ci", { [ENV]: "ci-annotations" }).result).toEqual(Option.some("ci-annotations"));
		expect(run("human", { [ENV]: "ci-annotations" }).result).toEqual(Option.none());
	});
});
