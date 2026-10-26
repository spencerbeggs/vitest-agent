/**
 * Flag defaults are computed when a command runs, not when its module loads.
 * `record`'s timestamp flags (`--occurred-at`, `--started-at`, `--ended-at`,
 * `--recorded-at`) default through `nowIso`, and `end-agent` / `inject-env`'s
 * `--cwd` through `currentCwd`. Each case parses the SAME command value twice
 * with the ambient input changed in between: a default captured once at
 * module load would answer the first value both times.
 */

import { Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentCwd, nowIso } from "../src/commands/flag-defaults.js";

const CliEnv = Layer.mergeAll(
	FileSystem.layerNoop({}),
	Path.layer,
	Stdio.layerTest({}),
	Layer.succeed(
		Terminal.Terminal,
		Terminal.make({
			columns: Effect.succeed(80),
			rows: Effect.succeed(24),
			readInput: Effect.die("unused"),
			readLine: Effect.die("unused"),
			display: () => Effect.void,
		}),
	),
	Layer.succeed(
		ChildProcessSpawner.ChildProcessSpawner,
		ChildProcessSpawner.make(() => Effect.die("unused")),
	),
);

/** One command whose `--value` defaults through `fallback`; every parse records what the handler saw. */
const probe = (fallback: Effect.Effect<string>) => {
	const seen: Array<string> = [];
	const command = Command.make("probe", { value: Flag.String("value").pipe(Flag.withDefault(fallback)) }, ({ value }) =>
		Effect.sync(() => {
			seen.push(value);
		}),
	);
	return { seen, run: Command.runWith(command, { version: "0.0.0" }) };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("run-time flag defaults", () => {
	it("nowIso reads the clock at each parse, not once at definition", async () => {
		const { seen, run } = probe(nowIso);
		await Effect.runPromise(
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-01-01T00:00:00.000Z"));
				yield* run([]);
				yield* TestClock.setTime(Date.parse("2026-06-01T12:30:00.000Z"));
				yield* run([]);
			}).pipe(Effect.provide(Layer.merge(CliEnv, TestClock.layer()))),
		);
		expect(seen).toEqual(["2026-01-01T00:00:00.000Z", "2026-06-01T12:30:00.000Z"]);
	});

	it("an explicit flag value wins over the clock default", async () => {
		const { seen, run } = probe(nowIso);
		await Effect.runPromise(
			run(["--value", "2020-02-02T00:00:00.000Z"]).pipe(Effect.provide(Layer.merge(CliEnv, TestClock.layer()))),
		);
		expect(seen).toEqual(["2020-02-02T00:00:00.000Z"]);
	});

	it("currentCwd reads process.cwd() at each parse, not once at definition", async () => {
		const { seen, run } = probe(currentCwd);
		const cwd = vi.spyOn(process, "cwd").mockReturnValueOnce("/first").mockReturnValueOnce("/second");
		await Effect.runPromise(
			Effect.gen(function* () {
				yield* run([]);
				yield* run([]);
			}).pipe(Effect.provide(CliEnv)),
		);
		expect(cwd).toHaveBeenCalledTimes(2);
		expect(seen).toEqual(["/first", "/second"]);
	});
});
