/**
 * What `run_tests` does around the nested Vitest run, in its `Exclusive`
 * lane: the per-call coverage temp directory (issues #159/#191/#194) exists
 * for the run and is removed after it, a failing temp dir and a hostile
 * rejection come back as the tool's `{ kind: "error" }` result, the
 * attribution env written for the run is restored when it ends, a
 * `vitest.start` past its timeout is `{ kind: "timeout" }` with the instance
 * still closed, and a reporter's stdout writes during `start` are diverted
 * off the wire while writes outside the run pass through.
 *
 * Seam: `vitestLoader.load` (the importer) is substituted so no nested Vitest
 * run starts; the stdio capture is installed on a fake host and provided as
 * `RunTestsStdio`, so its passthrough is observable without touching the
 * runner's own terminal.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StdioCapture } from "@effected/mcp/node";
import { MemoryFileSystem } from "@effected/memfs";
import { ProjectDiscoveryTest } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import { Effect, Layer, ManagedRuntime, PlatformError } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpSession } from "../src/session.js";
import { RunTestsStdio, vitestLoader } from "../src/tools/run-tests.js";
import { makeCaller } from "./utils/caller.js";

const GIT_IDENTITY_ENV = {
	GIT_AUTHOR_NAME: "vitest-agent-test",
	GIT_AUTHOR_EMAIL: "test@vitest-agent.dev",
	GIT_COMMITTER_NAME: "vitest-agent-test",
	GIT_COMMITTER_EMAIL: "test@vitest-agent.dev",
};

const createVitestMock = vi.fn();

const fakeVitest = (start: () => Promise<unknown> = async () => ({ testModules: [], unhandledErrors: [] })) => ({
	start: vi.fn(start),
	state: { getFiles: () => [] },
	close: vi.fn(async () => undefined),
});

/** The fake host's original writes: what reaches the "wire" past the capture. */
const wire: string[] = [];
const host = {
	stdout: {
		write: (chunk: unknown) => {
			wire.push(String(chunk));
			return true;
		},
	},
	stderr: {
		write: (chunk: unknown) => {
			wire.push(String(chunk));
			return true;
		},
	},
};
const capture = StdioCapture.install(host);

const BaseLayer = Layer.mergeAll(
	DataStoreTestLayer,
	ProjectDiscoveryTest.layer([]),
	Layer.succeed(RunTestsStdio, capture),
);

describe("run_tests lane", () => {
	let tmpRoot: string;
	let repo: string;
	const originalLoad = vitestLoader.load;
	const runtimes: Array<ManagedRuntime.ManagedRuntime<never, unknown>> = [];

	const callerFor = <R, E>(layer: Layer.Layer<R, E>) => {
		const runtime = ManagedRuntime.make(layer);
		runtimes.push(runtime as unknown as ManagedRuntime.ManagedRuntime<never, unknown>);
		return makeCaller(runtime, McpSession.layerTest({ cwd: repo }));
	};

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "va-run-tests-lane-"));
		repo = join(tmpRoot, "repo");
		mkdirSync(repo);
		execFileSync("git", ["init", "--quiet"], { cwd: repo });
		execFileSync("git", ["commit", "--allow-empty", "--quiet", "-m", "init"], {
			cwd: repo,
			env: { ...process.env, ...GIT_IDENTITY_ENV },
		});
		writeFileSync(join(repo, "vitest.config.ts"), "export default {};\n");
		createVitestMock.mockReset();
		wire.length = 0;
		vitestLoader.load = (async () => ({
			createVitest: (...args: unknown[]) => createVitestMock(...args),
		})) as unknown as typeof vitestLoader.load;
	});

	afterEach(async () => {
		vitestLoader.load = originalLoad;
		for (const runtime of runtimes.splice(0)) await runtime.dispose();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("should give each run its own coverage temp directory and remove it when the run ends", async () => {
		const seen: Array<{ dir: string; existed: boolean }> = [];
		createVitestMock.mockImplementation(async (options: { coverage: { reportsDirectory: string } }) => {
			const dir = options.coverage.reportsDirectory;
			seen.push({ dir, existed: existsSync(dir) });
			return fakeVitest();
		});
		const call = callerFor(BaseLayer);

		expect((await call("run_tests", {})).kind).toBe("ok");
		expect((await call("run_tests", {})).kind).toBe("ok");

		expect(seen).toHaveLength(2);
		const [first, second] = seen;
		expect(first?.dir).toContain("vitest-agent-cov-");
		expect(first?.existed).toBe(true);
		expect(second?.existed).toBe(true);
		expect(first?.dir).not.toBe(second?.dir);
		expect(existsSync(first?.dir ?? "")).toBe(false);
		expect(existsSync(second?.dir ?? "")).toBe(false);
	});

	it("should return the error envelope, without creating Vitest, when the coverage temp directory cannot be made", async () => {
		const Faulty = MemoryFileSystem.layerWith(
			{},
			{
				faults: {
					makeTempDirectory: () =>
						Effect.fail(
							PlatformError.systemError({
								_tag: "Unknown",
								module: "FileSystem",
								method: "makeTempDirectory",
								description: "ENOSPC: no space left on device, mkdtemp",
							}),
						),
				},
			},
		);
		const call = callerFor(Layer.mergeAll(BaseLayer, Faulty));

		const result = await call("run_tests", {});

		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(result.message).toContain("ENOSPC");
		expect(createVitestMock).not.toHaveBeenCalled();
	});

	it("should return a string message in the error envelope when createVitest rejects with a hostile value", async () => {
		const hostile: Record<string, unknown> = {};
		Object.defineProperty(hostile, "message", {
			get(): string {
				throw new TypeError("no message for you");
			},
			enumerable: true,
		});
		Object.defineProperty(hostile, "toString", {
			get(): never {
				throw new TypeError("no toString for you");
			},
		});
		createVitestMock.mockRejectedValue(hostile);
		const call = callerFor(BaseLayer);

		const result = await call("run_tests", {});

		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(typeof result.message).toBe("string");
	});

	it("should set the attribution env for the run and restore it when the run ends", async () => {
		const keys = ["VITEST_AGENT_CHAT_ID", "VITEST_AGENT_CONVERSATION_ID", "VITEST_AGENT_AGENT_ID"] as const;
		const before = keys.map((key) => process.env[key]);
		for (const key of keys) delete process.env[key];
		let during: Array<string | undefined> = [];
		createVitestMock.mockImplementation(async () => {
			during = keys.map((key) => process.env[key]);
			return fakeVitest();
		});
		const call = callerFor(BaseLayer);
		try {
			const result = await call("run_tests", {
				_sessionContext: { chatId: "chat-1", conversationId: "conv-1", mainAgentId: "agent-1" },
			});
			expect(result.kind).toBe("ok");
			expect(during).toEqual(["chat-1", "conv-1", "agent-1"]);
			expect(keys.map((key) => process.env[key])).toEqual([undefined, undefined, undefined]);
		} finally {
			keys.forEach((key, i) => {
				const value = before[i];
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			});
		}
	});

	it("should report a start past its timeout as kind timeout and still close the instance", async () => {
		const instance = fakeVitest(() => new Promise<never>(() => undefined));
		createVitestMock.mockResolvedValue(instance);
		const call = callerFor(BaseLayer);

		const result = await call("run_tests", { timeout: 0.05 });

		expect(result).toEqual({ kind: "timeout", timeoutSeconds: 0.05 });
		expect(instance.close).toHaveBeenCalledTimes(1);
	});

	it("should divert stdout written during start off the wire while a write outside the run passes through", async () => {
		createVitestMock.mockResolvedValue(
			fakeVitest(async () => {
				host.stdout.write("reporter-leak\n");
				host.stderr.write("reporter-err\n");
				return { testModules: [], unhandledErrors: [] };
			}),
		);
		const call = callerFor(BaseLayer);

		const result = await call("run_tests", {});
		host.stdout.write("transport-frame\n");

		expect(result.kind).toBe("ok");
		expect(wire).toEqual(["transport-frame\n"]);
	});
});
