/**
 * Server lifecycle over real stdio: the built `vitest-agent-mcp` bin is
 * spawned as a child process and driven with newline-framed JSON-RPC.
 *
 * Three contracts the bin owns (not the server layer): the initialize
 * handshake advertises `vitest-agent`, stderr never carries protocol bytes
 * and is silent for a clean session, and stdin EOF ends the process with
 * exit 0 promptly (a client disconnect is the ordinary end of every session,
 * not a crash — without a custom teardown `runMain` would report 130).
 */

import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { handshake, makeEnv, makeScratchProject, readResponse, spawnMcp } from "./utils/mcp-process.js";

const scratch = makeScratchProject("server-lifecycle-e2e");
const ENV = makeEnv(scratch);

afterAll(() => {
	rmSync(dirname(scratch.projectDir), { recursive: true, force: true });
});

const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> =>
	Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

describe("server lifecycle", () => {
	it("completes the initialize handshake and lists tools over real stdio", async () => {
		await run(
			Effect.scoped(
				Effect.gen(function* () {
					const server = yield* spawnMcp(ENV);
					const initialized = (yield* handshake(server)) as {
						readonly result: { readonly protocolVersion: string; readonly serverInfo: { readonly name: string } };
					};
					expect(initialized.result.serverInfo.name).toBe("vitest-agent");
					expect(initialized.result.protocolVersion).toBe("2025-11-25");
					yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
					const listed = (yield* readResponse(server, 2)) as {
						readonly result: { readonly tools: ReadonlyArray<{ readonly name: string }> };
					};
					expect(listed.result.tools.length).toBeGreaterThanOrEqual(2);
					expect(listed.result.tools.map((t) => t.name)).toContain("ping");
					yield* server.closeStdin;
				}),
			),
		);
	});

	it("stderr carries no protocol bytes and stays empty across handshake + ping", async () => {
		await run(
			Effect.scoped(
				Effect.gen(function* () {
					const server = yield* spawnMcp(ENV);
					yield* handshake(server);
					yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ping", arguments: {} } });
					const pong = (yield* readResponse(server, 2)) as {
						readonly result: { readonly structuredContent: { readonly message: string } };
					};
					expect(pong.result.structuredContent.message).toBe("pong");
					const stderr = yield* server.stderrSoFar;
					expect(stderr).not.toContain('"jsonrpc"');
					expect(stderr).not.toContain('"method"');
					expect(stderr).toBe("");
					yield* server.closeStdin;
				}),
			),
		);
	});

	it("exits non-zero with a diagnostic on stderr when startup fails", async () => {
		// A regular file where the XDG data directory should be makes
		// `resolveDataPath` / the SQLite layer fail before the server listens.
		const notADir = join(dirname(scratch.projectDir), "xdg-is-a-file");
		writeFileSync(notADir, "");
		await run(
			Effect.scoped(
				Effect.gen(function* () {
					const server = yield* spawnMcp({ ...ENV, XDG_DATA_HOME: notADir });
					const code = yield* server.exitCode.pipe(
						Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail("did not exit" as const) }),
					);
					expect(code).not.toBe(0);
					expect(yield* server.stderrSoFar).not.toBe("");
				}),
			),
		);
	});

	it("exits 0 within two seconds of stdin closing", async () => {
		await run(
			Effect.scoped(
				Effect.gen(function* () {
					const server = yield* spawnMcp(ENV);
					yield* handshake(server);
					yield* server.closeStdin;
					const code = yield* server.exitCode.pipe(
						Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail("did not exit" as const) }),
					);
					expect(code).toBe(0);
				}),
			),
		);
	});
});
