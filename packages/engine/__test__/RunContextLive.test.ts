import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RunContextTest } from "../src/layers/RunContextLive.js";
import { AgentContext, RunContext, RunContextService } from "../src/services/RunContext.js";

describe("RunContextTest layer", () => {
	const fixture = {
		runContext: new RunContext({
			gitBranch: "main",
			gitCommitSha: "abc123",
			gitDirty: false,
			gitUpstream: "origin/main",
			gitWorktreeDir: "/repo",
			hostSource: "TMUX_PANE",
			hostValue: "%2",
			hostMetadata: { ci: false },
		}),
		agentContext: new AgentContext({
			startGitBranch: "main",
			startGitCommitSha: "abc123",
			startWorktreeDir: "/repo",
		}),
	};

	it("returns the fixture from captureRunContext", async () => {
		const program = Effect.gen(function* () {
			const svc = yield* RunContextService;
			return yield* svc.captureRunContext("/whatever");
		}).pipe(Effect.provide(RunContextTest(fixture)));
		const result = await Effect.runPromise(program);
		expect(result).toEqual(fixture.runContext);
	});

	it("returns the fixture from captureAgentContext", async () => {
		const program = Effect.gen(function* () {
			const svc = yield* RunContextService;
			return yield* svc.captureAgentContext("/whatever");
		}).pipe(Effect.provide(RunContextTest(fixture)));
		const result = await Effect.runPromise(program);
		expect(result).toEqual(fixture.agentContext);
	});

	it("returns the same fixture for any cwd argument", async () => {
		const program = Effect.gen(function* () {
			const svc = yield* RunContextService;
			const a = yield* svc.captureRunContext("/path/a");
			const b = yield* svc.captureRunContext("/path/b");
			return [a, b];
		}).pipe(Effect.provide(RunContextTest(fixture)));
		const [a, b] = await Effect.runPromise(program);
		expect(a).toEqual(b);
	});
});
