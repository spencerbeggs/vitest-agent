import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { TestConsole } from "effect/testing";
import { afterEach, describe, expect, it } from "vitest";
import { LoggerLive, resolveLogFile, resolveLogLevel } from "../src/layers/LoggerLive.js";

describe("resolveLogLevel", () => {
	it("returns undefined when option and env var are both absent", () => {
		expect(resolveLogLevel({}, undefined)).toBeUndefined();
	});

	it("treats an empty env var as absent", () => {
		expect(resolveLogLevel({ VITEST_REPORTER_LOG_LEVEL: "" }, undefined)).toBeUndefined();
	});

	it("returns LogLevel.Debug for 'debug' (lowercase)", () => {
		expect(resolveLogLevel({}, "debug")).toBe("Debug");
	});

	it("returns LogLevel.Debug for 'Debug' (capitalized)", () => {
		expect(resolveLogLevel({}, "Debug")).toBe("Debug");
	});

	it("returns LogLevel.Info for 'INFO' (uppercase)", () => {
		expect(resolveLogLevel({}, "INFO")).toBe("Info");
	});

	it("falls back to env var when option is not provided", () => {
		expect(resolveLogLevel({ VITEST_REPORTER_LOG_LEVEL: "info" }, undefined)).toBe("Info");
	});

	it("explicit option takes priority over env var", () => {
		expect(resolveLogLevel({ VITEST_REPORTER_LOG_LEVEL: "info" }, "debug")).toBe("Debug");
	});

	it("returns undefined for an unknown level name", () => {
		expect(resolveLogLevel({ VITEST_REPORTER_LOG_LEVEL: "loud" }, undefined)).toBeUndefined();
	});

	it("resolves 'warn' alias to Warn", () => {
		expect(resolveLogLevel({}, "warn")).toBe("Warn");
	});

	it("resolves 'warning' to Warn", () => {
		expect(resolveLogLevel({}, "warning")).toBe("Warn");
	});

	it("resolves 'WARN' to Warn", () => {
		expect(resolveLogLevel({}, "WARN")).toBe("Warn");
	});
});

describe("resolveLogFile", () => {
	it("returns undefined when option and env var are both absent", () => {
		expect(resolveLogFile({}, undefined)).toBeUndefined();
	});

	it("returns the explicit path when provided", () => {
		expect(resolveLogFile({}, "/tmp/my-log.ndjson")).toBe("/tmp/my-log.ndjson");
	});

	it("falls back to env var when option is not provided", () => {
		expect(resolveLogFile({ VITEST_REPORTER_LOG_FILE: "/var/log/vitest.ndjson" }, undefined)).toBe(
			"/var/log/vitest.ndjson",
		);
	});

	it("explicit option takes priority over env var", () => {
		expect(resolveLogFile({ VITEST_REPORTER_LOG_FILE: "/env/path.log" }, "/explicit/path.log")).toBe(
			"/explicit/path.log",
		);
	});
});

describe("LoggerLive", () => {
	it("returns a layer (not undefined) for any input", () => {
		const layer = LoggerLive();
		expect(layer).toBeDefined();
	});

	it("returns a silent layer when level is undefined", () => {
		const layer = LoggerLive(undefined);
		// The layer replaces defaultLogger with none -- it is still a Layer
		expect(layer).toBeDefined();
		// Verify it is a Layer by checking it has the Layer brand
		expect(Layer.isLayer(layer)).toBe(true);
	});

	it("returns a silent layer when level is LogLevel.None", () => {
		const layer = LoggerLive("None");
		expect(Layer.isLayer(layer)).toBe(true);
	});

	it("returns a non-silent layer (merged) when level is Debug", () => {
		const layer = LoggerLive("Debug");
		expect(Layer.isLayer(layer)).toBe(true);
	});

	it("returns a layer with file logging when logFile is provided", () => {
		const layer = LoggerLive("Debug", "/tmp/test-log.ndjson");
		expect(Layer.isLayer(layer)).toBe(true);
	});

	it("returns a layer without file logging when only level is provided", () => {
		const layer = LoggerLive("Info");
		expect(Layer.isLayer(layer)).toBe(true);
	});
});

/**
 * Run a program that logs one record per level under `LoggerLive`, with the
 * `Console` swapped for `TestConsole` so every stderr/stdout line is captured.
 */
const captureUnder = (layer: Layer.Layer<never>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			yield* Effect.logDebug("dbg-line");
			yield* Effect.logInfo("info-line");
			yield* Effect.logWarning("warn-line");
			return { stderr: yield* TestConsole.errorLines, stdout: yield* TestConsole.logLines };
		}).pipe(Effect.provide(layer), Effect.provide(TestConsole.layer)),
	);

const messages = (lines: ReadonlyArray<unknown>) => lines.map((line) => JSON.parse(String(line)).message);

describe("LoggerLive output (over CliLog)", () => {
	let dir: string | undefined;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	it("is silent on stdout and stderr when no level is set", async () => {
		expect(await captureUnder(LoggerLive())).toEqual({ stderr: [], stdout: [] });
		expect(await captureUnder(LoggerLive("None"))).toEqual({ stderr: [], stdout: [] });
	});

	it("writes one NDJSON line per record at or above the level, to stderr only", async () => {
		const { stderr, stdout } = await captureUnder(LoggerLive("Debug"));
		expect(stdout).toEqual([]);
		// Exactly one line each: no second, plain CliLogger copy of the Info+ records.
		expect(messages(stderr)).toEqual(["dbg-line", "info-line", "warn-line"]);
	});

	it("filters below the level", async () => {
		const { stderr } = await captureUnder(LoggerLive("Warn"));
		expect(messages(stderr)).toEqual(["warn-line"]);
	});

	it("appends the same NDJSON lines to the log file", async () => {
		dir = mkdtempSync(join(tmpdir(), "engine-logger-"));
		const file = join(dir, "nested", "diag.ndjson");
		const { stderr } = await captureUnder(LoggerLive("Info", file));
		const fileLines = readFileSync(file, "utf8").trimEnd().split("\n");
		expect(messages(fileLines)).toEqual(["info-line", "warn-line"]);
		expect(fileLines).toEqual(stderr.map(String));
	});
});

describe("LoggerLive under GitHub Actions (injected env)", () => {
	// `##[` is read by the runner's legacy parser anywhere in a line; `::cmd::`
	// only at line start. The record is logged from a fiber that carries no
	// `CurrentRuntimeEnv`, so only the env `LoggerLive` built in can neutralize it.
	const injected = "::error::injected ##[error]legacy";
	const capture = (layer: Layer.Layer<never>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				yield* Effect.logWarning(injected);
				return yield* TestConsole.errorLines;
			}).pipe(Effect.provide(layer), Effect.provide(TestConsole.layer)),
		);

	it("writes no workflow command to stderr and escapes ##[ in the NDJSON line", async () => {
		const stderr = (await capture(LoggerLive("Warn", undefined, { GITHUB_ACTIONS: "true" }))).map(String);
		expect(stderr).toHaveLength(1);
		for (const line of stderr) {
			expect(line.trimStart()).not.toMatch(/^::/);
			expect(line).not.toContain("##[");
		}
		// The escape is JSON-level: the decoded message is the text as logged.
		expect(messages(stderr)).toEqual([injected]);
	});

	it("control: without an env the same record keeps ##[ raw", async () => {
		const stderr = (await capture(LoggerLive("Warn"))).map(String);
		expect(stderr).toHaveLength(1);
		expect(stderr[0]).toContain("##[");
	});
});
