/**
 * Subprocess resilience regression for issue #191, sub-item A.
 *
 * `main.ts` registers `unhandledRejection` / `uncaughtException` guards
 * through `McpGuard.run` (`@effected/mcp/guard`) before any of the server
 * graph is imported, with policy `{ onUncaught: "exitBeforeConnect",
 * onRejection: "log" }`. Under Node >=15 an unhandled
 * rejection anywhere in the process crashes it by default, closing the
 * stdio transport and silently deregistering every tool mid session. These
 * cases spawn the *real built* bin (a crash in the test's own process is
 * exactly what must NOT happen here) with the env-gated
 * `VITEST_AGENT_MCP_TEST_INJECT_CRASH` hook, which `main.ts` maps to the
 * guard's `injectCrash`: `<at>:<kind>` with `at` = `load` (before `load()`
 * runs) or `connected` (once the whole server layer has built), and a bare
 * `<kind>` meaning `connected`. Every injection carries the guard's
 * `[injected] <kind>` message on stderr.
 *
 * - `connected`, either kind: logged, and `ping` still answers.
 * - `load:uncaughtException`: `exitBeforeConnect` exits 1 before `load()`
 *   runs, so the process never serves and never opens `data.db`.
 * - `load:unhandledRejection`: `onRejection: "log"` logs it and the guard
 *   goes on to call `load()`, so the server serves normally.
 */

import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { McpProcess } from "@effected/mcp/testing";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { makeEnv, makeScratchProject, spawnMcp } from "./utils/mcp-process.js";

const scratch = makeScratchProject("bin-crash-resilience-e2e");
const scratches = [scratch];

/** A scratch project of its own, so a case can assert nothing was written under its XDG data dir. */
const freshScratch = (name: string): { projectDir: string; xdgDataHome: string } => {
	const fresh = makeScratchProject(name);
	scratches.push(fresh);
	return fresh;
};

afterAll(() => {
	for (const entry of scratches) rmSync(dirname(entry.projectDir), { recursive: true, force: true });
});

/** Poll stderr (50 ms steps, 2 s bound) until it contains `needle`; returns what was captured. */
const waitForStderr = (server: McpProcess, needle: string): Effect.Effect<string> =>
	Effect.gen(function* () {
		for (let i = 0; i < 40; i++) {
			const stderr = yield* server.stderrSoFar;
			if (stderr.includes(needle)) return stderr;
			yield* Effect.sleep("50 millis");
		}
		return yield* server.stderrSoFar;
	});

type Kind = "unhandledRejection" | "uncaughtException";

/** The guard's report line prefix for `kind`. */
const reportPrefix = (kind: Kind): string =>
	kind === "uncaughtException" ? "vitest-agent-mcp: uncaughtException" : "vitest-agent-mcp: unhandledRejection";

/** Spawn with `inject`, then prove the server reported `kind` and still answers `ping`. */
const survives = (kind: Kind, inject: string, project = scratch): Promise<void> =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const server = yield* spawnMcp(makeEnv(project, { VITEST_AGENT_MCP_TEST_INJECT_CRASH: inject }));
				yield* server.handshake();
				// The injected crash fires on a setTimeout(0) once the server is
				// serving. Wait for its stderr line BEFORE probing liveness, so the
				// case proves the server survived the crash rather than merely that
				// the crash happened at some point.
				const crashed = yield* waitForStderr(server, `[injected] ${kind}`);
				expect(crashed, `expected stderr to report ${kind} before ping`).toContain(reportPrefix(kind));
				expect(crashed).toContain(`[injected] ${kind}`);
				yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ping", arguments: {} } });
				const { response: pong } = (yield* server.readUntilResponse(2)) as unknown as {
					readonly response: {
						readonly result: { readonly isError?: boolean; readonly structuredContent: { readonly message: string } };
					};
				};
				expect(pong.result.isError).not.toBe(true);
				expect(pong.result.structuredContent.message).toBe("pong");
				yield* server.closeStdin;
			}),
		).pipe(Effect.provide(NodeServices.layer)),
	);

describe("MCP bin subprocess crash resilience", () => {
	it("survives an injected unhandledRejection after the transport connects", () =>
		survives("unhandledRejection", "unhandledRejection"));

	it("survives an injected uncaughtException after the transport connects", () =>
		survives("uncaughtException", "uncaughtException"));

	it("reads connected:<kind> as the bare legacy value", () =>
		survives("uncaughtException", "connected:uncaughtException"));

	it("exits 1 on an uncaughtException before load, never serving or opening the database", () => {
		const project = freshScratch("bin-crash-load-uncaught-e2e");
		return Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const server = yield* spawnMcp(
						makeEnv(project, { VITEST_AGENT_MCP_TEST_INJECT_CRASH: "load:uncaughtException" }),
					);
					const code = yield* server.exitCode.pipe(
						Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail("did not exit" as const) }),
					);
					expect(code).toBe(1);
					const stderr = yield* server.stderrFinal;
					expect(stderr).toContain(`${reportPrefix("uncaughtException")} (uncaughtException): `);
					expect(stderr).toContain("[injected] uncaughtException");
					// Never served: stdout closed without one JSON-RPC line, and
					// `load()` never ran, so nothing resolved or created the database.
					const line = yield* Effect.result(server.nextLine);
					expect(line._tag).toBe("Failure");
					expect(existsSync(join(project.xdgDataHome, "vitest-agent"))).toBe(false);
				}),
			).pipe(Effect.provide(NodeServices.layer)),
		);
	});

	it("logs an unhandledRejection before load under onRejection log, then loads and serves", async () => {
		const project = freshScratch("bin-crash-load-rejection-e2e");
		await survives("unhandledRejection", "load:unhandledRejection", project);
		// The control for the case above: a server that did load opened its database.
		expect(existsSync(join(project.xdgDataHome, "vitest-agent"))).toBe(true);
	});
});
