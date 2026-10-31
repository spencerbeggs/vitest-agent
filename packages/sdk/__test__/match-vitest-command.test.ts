import { describe, expect, it } from "vitest";
import {
	buildEnvPrefix,
	detectVitestScripts,
	isVitestInvocation,
	rewriteBashCommand,
} from "../src/utils/match-vitest-command.js";

const noScripts = new Set<string>();

describe("isVitestInvocation", () => {
	it("matches direct vitest invocation", () => {
		expect(isVitestInvocation("vitest", noScripts)).toBe(true);
		expect(isVitestInvocation("vitest run", noScripts)).toBe(true);
		expect(isVitestInvocation("  vitest --watch", noScripts)).toBe(true);
	});

	it("matches one-off runners (npx, pnpx, bunx)", () => {
		expect(isVitestInvocation("npx vitest run", noScripts)).toBe(true);
		expect(isVitestInvocation("pnpx vitest", noScripts)).toBe(true);
		expect(isVitestInvocation("bunx vitest run", noScripts)).toBe(true);
	});

	it("matches PM-mediated exec (pnpm exec, npm exec, yarn exec, bun x)", () => {
		expect(isVitestInvocation("pnpm exec vitest run", noScripts)).toBe(true);
		expect(isVitestInvocation("npm exec vitest", noScripts)).toBe(true);
		expect(isVitestInvocation("yarn exec vitest", noScripts)).toBe(true);
		expect(isVitestInvocation("bun x vitest", noScripts)).toBe(true);
	});

	it("matches direct binary path", () => {
		expect(isVitestInvocation("node node_modules/.bin/vitest run", noScripts)).toBe(true);
		expect(isVitestInvocation("node ./node_modules/.bin/vitest", noScripts)).toBe(true);
	});

	it("matches package.json script indirection when scripts set contains the name", () => {
		const scripts = new Set(["test"]);
		expect(isVitestInvocation("pnpm test", scripts)).toBe(true);
		expect(isVitestInvocation("pnpm run test", scripts)).toBe(true);
		expect(isVitestInvocation("npm test", scripts)).toBe(true);
		expect(isVitestInvocation("yarn test", scripts)).toBe(true);
		expect(isVitestInvocation("bun test", scripts)).toBe(true);
	});

	it("does NOT match unrelated commands", () => {
		expect(isVitestInvocation("ls", noScripts)).toBe(false);
		expect(isVitestInvocation("echo vitest", noScripts)).toBe(false); // not anchored at start
		expect(isVitestInvocation("vitestlike", noScripts)).toBe(false); // word boundary required
		expect(isVitestInvocation("pnpm build", new Set(["test"]))).toBe(false);
	});

	it("does NOT match &&-chained commands where vitest is the second invocation", () => {
		// Documented limitation — anchored at start only.
		expect(isVitestInvocation("pnpm build && pnpm vitest run", new Set(["test"]))).toBe(false);
	});

	it("respects word boundaries on the runner names", () => {
		expect(isVitestInvocation("pnpmx vitest", noScripts)).toBe(false);
	});
});

describe("buildEnvPrefix", () => {
	it("emits CONVERSATION_ID and AGENT_ID by default", () => {
		const prefix = buildEnvPrefix({
			conversationId: "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b",
			agentId: "7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6",
		});
		expect(prefix).toBe(
			"VITEST_AGENT_CONVERSATION_ID=0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b VITEST_AGENT_AGENT_ID=7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6",
		);
	});

	it("appends PARENT_AGENT_ID when supplied (subagent case)", () => {
		const prefix = buildEnvPrefix({
			conversationId: "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b",
			agentId: "7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6",
			parentAgentId: "c3a1e2b4-5d6f-4a7b-9c8d-e0f1a2b3c4d5",
		});
		expect(prefix).toBe(
			"VITEST_AGENT_CONVERSATION_ID=0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b VITEST_AGENT_AGENT_ID=7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6 VITEST_AGENT_PARENT_AGENT_ID=c3a1e2b4-5d6f-4a7b-9c8d-e0f1a2b3c4d5",
		);
	});
});

describe("buildEnvPrefix — shell-unsafe ids", () => {
	const CONV = "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b";
	const AGENT = "7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6";

	it("returns an empty prefix when a required id is not a UUID", () => {
		expect(buildEnvPrefix({ conversationId: CONV, agentId: "a b" })).toBe("");
		expect(buildEnvPrefix({ conversationId: "$(id)", agentId: AGENT })).toBe("");
	});

	it("omits a parent id that is not a UUID", () => {
		expect(buildEnvPrefix({ conversationId: CONV, agentId: AGENT, parentAgentId: "x;y" })).toBe(
			`VITEST_AGENT_CONVERSATION_ID=${CONV} VITEST_AGENT_AGENT_ID=${AGENT}`,
		);
	});
});

describe("rewriteBashCommand — shell-unsafe ids", () => {
	it("returns the command unchanged when a required id is not a UUID", () => {
		const out = rewriteBashCommand({
			command: "vitest run",
			vitestScripts: noScripts,
			conversationId: "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b",
			agentId: "evil\nid",
		});
		expect(out).toBe("vitest run");
	});
});

describe("rewriteBashCommand", () => {
	it("returns the original command unchanged when no Vitest pattern matches", () => {
		const out = rewriteBashCommand({
			command: "ls -la",
			vitestScripts: noScripts,
			conversationId: "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b",
			agentId: "7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6",
		});
		expect(out).toBe("ls -la");
	});

	it("prepends the env prefix when a Vitest pattern matches", () => {
		const out = rewriteBashCommand({
			command: "pnpm vitest run",
			vitestScripts: new Set(["vitest"]),
			conversationId: "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b",
			agentId: "7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6",
		});
		expect(out).toBe(
			"VITEST_AGENT_CONVERSATION_ID=0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b VITEST_AGENT_AGENT_ID=7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6 pnpm vitest run",
		);
	});

	it("includes the parent prefix on subagent rewrites", () => {
		const out = rewriteBashCommand({
			command: "vitest run",
			vitestScripts: noScripts,
			conversationId: "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b",
			agentId: "7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6",
			parentAgentId: "c3a1e2b4-5d6f-4a7b-9c8d-e0f1a2b3c4d5",
		});
		expect(out).toBe(
			"VITEST_AGENT_CONVERSATION_ID=0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b VITEST_AGENT_AGENT_ID=7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6 VITEST_AGENT_PARENT_AGENT_ID=c3a1e2b4-5d6f-4a7b-9c8d-e0f1a2b3c4d5 vitest run",
		);
	});
});

describe("detectVitestScripts", () => {
	it("identifies direct hits where the script body mentions vitest", () => {
		const detected = detectVitestScripts({
			test: "vitest run",
			build: "tsc",
			lint: "biome check .",
		});
		expect(detected.has("test")).toBe(true);
		expect(detected.has("build")).toBe(false);
		expect(detected.has("lint")).toBe(false);
	});

	it("identifies one-hop indirection scripts", () => {
		const detected = detectVitestScripts({
			"test:unit": "vitest run packages/unit",
			test: "pnpm test:unit",
			build: "tsc",
		});
		expect(detected.has("test:unit")).toBe(true);
		expect(detected.has("test")).toBe(true);
		expect(detected.has("build")).toBe(false);
	});

	it("returns empty set when no script mentions vitest", () => {
		const detected = detectVitestScripts({ build: "tsc", lint: "biome check ." });
		expect(detected.size).toBe(0);
	});

	it("does not match vitestlike substrings (word boundary)", () => {
		const detected = detectVitestScripts({ test: "run-vitestlike-tool" });
		expect(detected.has("test")).toBe(false);
	});
});
