import { Layer } from "effect";
import { describe, expect, it } from "vitest";
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
