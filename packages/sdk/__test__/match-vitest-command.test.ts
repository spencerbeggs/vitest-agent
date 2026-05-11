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
		const prefix = buildEnvPrefix({ conversationId: "conv-1", agentId: "agent-1" });
		expect(prefix).toBe("VITEST_AGENT_CONVERSATION_ID=conv-1 VITEST_AGENT_AGENT_ID=agent-1");
	});

	it("appends PARENT_AGENT_ID when supplied (subagent case)", () => {
		const prefix = buildEnvPrefix({
			conversationId: "conv-1",
			agentId: "sub-agent-1",
			parentAgentId: "main-agent-1",
		});
		expect(prefix).toBe(
			"VITEST_AGENT_CONVERSATION_ID=conv-1 VITEST_AGENT_AGENT_ID=sub-agent-1 VITEST_AGENT_PARENT_AGENT_ID=main-agent-1",
		);
	});
});

describe("rewriteBashCommand", () => {
	it("returns the original command unchanged when no Vitest pattern matches", () => {
		const out = rewriteBashCommand({
			command: "ls -la",
			vitestScripts: noScripts,
			conversationId: "c1",
			agentId: "a1",
		});
		expect(out).toBe("ls -la");
	});

	it("prepends the env prefix when a Vitest pattern matches", () => {
		const out = rewriteBashCommand({
			command: "pnpm vitest run",
			vitestScripts: new Set(["vitest"]),
			conversationId: "c1",
			agentId: "a1",
		});
		expect(out).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 pnpm vitest run");
	});

	it("includes the parent prefix on subagent rewrites", () => {
		const out = rewriteBashCommand({
			command: "vitest run",
			vitestScripts: noScripts,
			conversationId: "c1",
			agentId: "sub-1",
			parentAgentId: "main-1",
		});
		expect(out).toBe(
			"VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=sub-1 VITEST_AGENT_PARENT_AGENT_ID=main-1 vitest run",
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
