/**
 * Spawn the built `vitest-agent-mcp` bin as a long-lived child process a test
 * can drive incrementally over real stdio.
 *
 * Unlike a CLI helper that drains stdout/stderr/exit to completion, a server
 * never returns while stdin is open, so this exposes `send` / `nextLine` /
 * `closeStdin` / `exitCode` / `stderrSoFar` and drains the three pipes in
 * forked fibers for the life of the scope.
 *
 * `handle.stdin` is a `Sink`, not a writable: an unbounded
 * `Queue<Uint8Array, Cause.Done>` is streamed into it once. `closeStdin` is
 * `Queue.end`, which `Stream.fromQueue` treats as a graceful end — pending
 * offers are flushed, then the child's stdin fd closes (`StdinConfig.endOnDone`
 * defaults to `true`). `Queue.shutdown` was rejected because it interrupts
 * takers immediately and could truncate an in-flight frame.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Cause, PlatformError, Scope } from "effect";
import { Effect, Queue, Ref, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/** The built dev bin, resolved from this file's own location, never from cwd. */
export const MCP_BIN: string = resolve(
	import.meta.dirname,
	"..",
	"..",
	"dist",
	"dev",
	"pkg",
	"bin",
	"vitest-agent-mcp.js",
);

/** A live server process a test can write to while it runs. */
export interface McpProcess {
	/** JSON-encode one message and write it, newline-framed, to the child's stdin. */
	readonly send: (message: unknown) => Effect.Effect<void>;
	/** The next complete, non-empty stdout line. */
	readonly nextLine: Effect.Effect<string>;
	/** Close the child's stdin, which is what should end the server's scope. */
	readonly closeStdin: Effect.Effect<void>;
	/** The child's exit code (fails only if the OS wait itself errors). */
	readonly exitCode: Effect.Effect<number, PlatformError.PlatformError>;
	/** Everything written to stderr so far. */
	readonly stderrSoFar: Effect.Effect<string>;
}

/**
 * A throwaway project directory with a `package.json` name (the engine's
 * project identity) plus a private `XDG_DATA_HOME`, so a spawned server never
 * touches the developer's real `data.db`.
 */
export const makeScratchProject = (name = "mcp-e2e-scratch"): { projectDir: string; xdgDataHome: string } => {
	const root = mkdtempSync(join(tmpdir(), "va-mcp-e2e-"));
	const projectDir = join(root, "project");
	const xdgDataHome = join(root, "xdg-data");
	// The engine creates the XDG data dir on first use; the project dir must
	// carry its manifest up front.
	mkdirSync(projectDir, { recursive: true });
	writeFileSync(join(projectDir, "package.json"), `${JSON.stringify({ name, version: "0.0.0", private: true })}\n`);
	return { projectDir, xdgDataHome };
};

/**
 * The explicit environment for a spawned server. Never `extendEnv`: the
 * parent's `npm_*` / `VITEST_*` noise must not leak into the child.
 */
export const makeEnv = (
	scratch: { projectDir: string; xdgDataHome: string },
	extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> => ({
	PATH: process.env.PATH ?? "",
	HOME: process.env.HOME ?? "",
	NO_COLOR: "1",
	XDG_DATA_HOME: scratch.xdgDataHome,
	VITEST_AGENT_REPORTER_PROJECT_DIR: scratch.projectDir,
	...extra,
});

/** Spawn the built bin as a long-lived server with the given explicit env. */
export const spawnMcp = (
	env: Readonly<Record<string, string>>,
	args: ReadonlyArray<string> = [],
): Effect.Effect<McpProcess, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [MCP_BIN, ...args], { env }));

		const encoder = new TextEncoder();
		const stdin = yield* Queue.make<Uint8Array, Cause.Done>();
		yield* Stream.run(Stream.fromQueue(stdin), handle.stdin).pipe(Effect.forkScoped);

		const lines = yield* Queue.unbounded<string>();
		let pending = "";
		yield* Stream.decodeText(handle.stdout)
			.pipe(
				Stream.runForEach((text) =>
					Effect.gen(function* () {
						pending += text;
						let newline = pending.indexOf("\n");
						while (newline !== -1) {
							const line = pending.slice(0, newline);
							pending = pending.slice(newline + 1);
							if (line.length > 0) yield* Queue.offer(lines, line);
							newline = pending.indexOf("\n");
						}
					}),
				),
			)
			.pipe(Effect.forkScoped);

		const stderrRef = yield* Ref.make("");
		yield* Stream.decodeText(handle.stderr)
			.pipe(Stream.runForEach((text) => Ref.update(stderrRef, (current) => current + text)))
			.pipe(Effect.forkScoped);

		const send = (message: unknown): Effect.Effect<void> =>
			Queue.offer(stdin, encoder.encode(`${JSON.stringify(message)}\n`)).pipe(Effect.asVoid);

		return {
			send,
			nextLine: Queue.take(lines),
			closeStdin: Queue.end(stdin).pipe(Effect.asVoid),
			exitCode: handle.exitCode,
			stderrSoFar: Ref.get(stderrRef),
		};
	});

/** A minimal JSON-RPC line as parsed off stdout. */
export interface JsonRpcLine {
	readonly jsonrpc?: unknown;
	readonly id?: unknown;
	readonly method?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

/**
 * Read stdout lines until one carries the requested `id`, skipping any
 * unsolicited notification (`notifications/tools/list_changed` etc.) that
 * interleaves with the request/response pair.
 */
export const readResponse = (server: McpProcess, id: number): Effect.Effect<JsonRpcLine> =>
	Effect.gen(function* () {
		while (true) {
			const parsed = JSON.parse(yield* server.nextLine) as JsonRpcLine;
			if (parsed.id === id) return parsed;
		}
	});

/** The `initialize` request every case starts with. */
export const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-11-25",
		capabilities: {},
		clientInfo: { name: "vitest-agent-e2e", version: "0.0.0" },
	},
} as const;

/** `initialize` → `notifications/initialized`, returning the initialize response. */
export const handshake = (server: McpProcess): Effect.Effect<JsonRpcLine> =>
	Effect.gen(function* () {
		yield* server.send(INITIALIZE);
		const initialized = yield* readResponse(server, 1);
		yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		return initialized;
	});
