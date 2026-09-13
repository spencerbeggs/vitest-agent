/**
 * Subprocess resilience regression for issue #191, sub-item A.
 *
 * `main.ts` registers `unhandledRejection` / `uncaughtException` guards
 * before any of the server graph is imported. Under Node >=15 an unhandled
 * rejection anywhere in the process crashes it by default, closing the
 * stdio transport and silently deregistering every tool mid session. These
 * cases spawn the *real built* bin (a crash in the test's own process is
 * exactly what must NOT happen here) with the env-gated
 * `VITEST_AGENT_MCP_TEST_INJECT_CRASH` hook, which fires once after the
 * transport is connected, then prove `ping` still answers and the crash was
 * reported on stderr.
 */

import { rmSync } from "node:fs";
import { dirname } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import type { McpProcess } from "./utils/mcp-process.js";
import { handshake, makeEnv, makeScratchProject, readResponse, spawnMcp } from "./utils/mcp-process.js";

const scratch = makeScratchProject("bin-crash-resilience-e2e");

afterAll(() => {
	rmSync(dirname(scratch.projectDir), { recursive: true, force: true });
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

const survives = (kind: "unhandledRejection" | "uncaughtException"): Promise<void> =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const server = yield* spawnMcp(makeEnv(scratch, { VITEST_AGENT_MCP_TEST_INJECT_CRASH: kind }));
				yield* handshake(server);
				// The injected crash fires on the setImmediate after the transport
				// connects. Wait for its stderr line BEFORE probing liveness, so the
				// case proves the server survived the crash rather than merely that
				// the crash happened at some point.
				const crashed = yield* waitForStderr(server, kind);
				expect(crashed, `expected stderr to report ${kind} before ping`).toContain(kind);
				yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ping", arguments: {} } });
				const pong = (yield* readResponse(server, 2)) as {
					readonly result: { readonly isError?: boolean; readonly structuredContent: { readonly message: string } };
				};
				expect(pong.result.isError).not.toBe(true);
				expect(pong.result.structuredContent.message).toBe("pong");
				yield* server.closeStdin;
			}),
		).pipe(Effect.provide(NodeServices.layer)),
	);

describe("MCP bin subprocess crash resilience", () => {
	it("survives an injected unhandledRejection after the transport connects", () => survives("unhandledRejection"));

	it("survives an injected uncaughtException after the transport connects", () => survives("uncaughtException"));
});
