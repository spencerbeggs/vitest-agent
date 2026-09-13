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
import { handshake, makeEnv, makeScratchProject, readResponse, spawnMcp } from "./utils/mcp-process.js";

const scratch = makeScratchProject("bin-crash-resilience-e2e");

afterAll(() => {
	rmSync(dirname(scratch.projectDir), { recursive: true, force: true });
});

const survives = (kind: "unhandledRejection" | "uncaughtException"): Promise<void> =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const server = yield* spawnMcp(makeEnv(scratch, { VITEST_AGENT_MCP_TEST_INJECT_CRASH: kind }));
				yield* handshake(server);
				// Give the injected setImmediate crash a turn to fire and be handled
				// before probing liveness.
				yield* Effect.sleep("300 millis");
				yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ping", arguments: {} } });
				const pong = (yield* readResponse(server, 2)) as {
					readonly result: { readonly isError?: boolean; readonly structuredContent: { readonly message: string } };
				};
				expect(pong.result.isError).not.toBe(true);
				expect(pong.result.structuredContent.message).toBe("pong");
				expect(yield* server.stderrSoFar).toContain(kind);
				yield* server.closeStdin;
			}),
		).pipe(Effect.provide(NodeServices.layer)),
	);

describe("MCP bin subprocess crash resilience", () => {
	it("survives an injected unhandledRejection after the transport connects", () => survives("unhandledRejection"));

	it("survives an injected uncaughtException after the transport connects", () => survives("uncaughtException"));
});
