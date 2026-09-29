/**
 * PR #521 review finding: `run_tests` serializes its body through
 * `runTestsSemaphore` because the body mutates process-global state
 * (`process.chdir`, `process.env.VITEST_AGENT_*`). The MCP server maps a
 * client `notifications/cancelled` to an interrupt of the request fiber;
 * if the permit is released on that interrupt while the body's promise
 * keeps running, a second call starts mid-run, captures the first run's
 * root as its `previousCwd`, and the first run's `finally` later chdirs
 * underneath it. The permit must be held until the body settles.
 *
 * Seam: `vitestLoader.load` is substituted (see run-tests-project-root.test.ts)
 * so no nested Vitest run starts. Ordering is asserted through latches and an
 * event log, never sleeps.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectDiscoveryTest } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import { Effect, Fiber, Layer, ManagedRuntime, Option, Semaphore } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpSession } from "../src/session.js";
import { handleRunTests, runTestsSemaphore, vitestLoader } from "../src/tools/run-tests.js";

const createVitestMock = vi.fn();

const GIT_IDENTITY_ENV = {
	GIT_AUTHOR_NAME: "vitest-agent-test",
	GIT_AUTHOR_EMAIL: "test@vitest-agent.dev",
	GIT_COMMITTER_NAME: "vitest-agent-test",
	GIT_COMMITTER_EMAIL: "test@vitest-agent.dev",
};

function initGitRepo(dir: string): void {
	execFileSync("git", ["init", "--quiet"], { cwd: dir });
	execFileSync("git", ["commit", "--allow-empty", "--quiet", "-m", "init"], {
		cwd: dir,
		env: { ...process.env, ...GIT_IDENTITY_ENV },
	});
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/** Yield to the macrotask queue N times so the runtime can process an interrupt. */
async function yieldTicks(n: number): Promise<void> {
	for (let i = 0; i < n; i++) {
		await new Promise<void>((r) => setImmediate(r));
	}
}

const TestLayer = Layer.mergeAll(DataStoreTestLayer, ProjectDiscoveryTest.layer([]));

describe("run_tests permit under MCP cancellation", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Layer.Success<typeof TestLayer>, Layer.Error<typeof TestLayer>>;
	let tmpRoot: string;
	const originalVitestLoad = vitestLoader.load;

	beforeEach(() => {
		runtime = ManagedRuntime.make(TestLayer);
		tmpRoot = mkdtempSync(join(tmpdir(), "va-run-tests-cancel-"));
		createVitestMock.mockReset();
		vitestLoader.load = (async () => ({
			createVitest: (...args: unknown[]) => createVitestMock(...args),
		})) as unknown as typeof vitestLoader.load;
	});

	afterEach(async () => {
		await runtime.dispose();
		rmSync(tmpRoot, { recursive: true, force: true });
		vitestLoader.load = originalVitestLoad;
	});

	const makeRepo = () => {
		const main = join(tmpRoot, "main");
		mkdirSync(main);
		initGitRepo(main);
		writeFileSync(join(main, "vitest.config.ts"), "export default {};\n");
		return main;
	};

	const callEffect = (cwd: string) => handleRunTests({}).pipe(Effect.provide(McpSession.layerTest({ cwd })));

	it("should hold the permit until the first body settles when its request fiber is interrupted, so a second call starts only after cwd is restored", async () => {
		const main = makeRepo();
		const before = process.cwd();
		const log: string[] = [];
		const entered1 = deferred();
		const release1 = deferred();

		createVitestMock.mockImplementationOnce(async () => {
			entered1.resolve();
			await release1.promise;
			return {
				start: vi.fn(async () => ({ testModules: [], unhandledErrors: [] })),
				state: { getFiles: () => [] },
				close: vi.fn(async () => {
					log.push("first-close");
				}),
			};
		});
		createVitestMock.mockImplementationOnce(async () => {
			log.push(`second-create:${process.cwd()}`);
			return {
				start: vi.fn(async () => ({ testModules: [], unhandledErrors: [] })),
				state: { getFiles: () => [] },
				close: vi.fn(async () => undefined),
			};
		});

		const fiber1 = runtime.runFork(callEffect(main));
		await entered1.promise;

		// The client cancels the call: the request fiber is interrupted while
		// the body is blocked inside createVitest.
		fiber1.interruptUnsafe();
		await yieldTicks(25);

		// The body is still running, so the permit must still be held.
		const probe = await Effect.runPromise(Semaphore.withPermitsIfAvailable(runTestsSemaphore, 1)(Effect.void));
		expect(Option.isNone(probe)).toBe(true);

		const second = runtime.runPromise(callEffect(main));
		release1.resolve();
		const secondResult = await second;
		await runtime.runPromise(Fiber.await(fiber1));

		expect(secondResult.kind).toBe("ok");
		expect(log).toEqual(["first-close", `second-create:${realpathSync(main)}`]);
		expect(process.cwd()).toBe(before);
	});

	it("should run and skip the cwd restore when the current working directory has been deleted", async () => {
		const main = makeRepo();
		const doomed = join(tmpRoot, "doomed");
		mkdirSync(doomed);
		const before = process.cwd();
		createVitestMock.mockResolvedValue({
			start: vi.fn(async () => ({ testModules: [], unhandledErrors: [] })),
			state: { getFiles: () => [] },
			close: vi.fn(async () => undefined),
		});

		process.chdir(doomed);
		rmSync(doomed, { recursive: true, force: true });
		try {
			expect(() => process.cwd()).toThrow();
			const result = await runtime.runPromise(callEffect(main));
			expect(result.kind).toBe("ok");
			expect(createVitestMock).toHaveBeenCalledTimes(1);
		} finally {
			process.chdir(before);
		}
	});
});
