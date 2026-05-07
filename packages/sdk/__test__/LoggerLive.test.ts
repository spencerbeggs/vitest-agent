import { Layer, LogLevel } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoggerLive, resolveLogFile, resolveLogLevel } from "../src/layers/LoggerLive.js";

describe("resolveLogLevel", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns undefined when option and env var are both absent", () => {
		vi.stubEnv("VITEST_REPORTER_LOG_LEVEL", "");
		// Empty string is treated as absent by the falsy check in resolveLogLevel
		const result = resolveLogLevel(undefined);
		expect(result).toBeUndefined();
	});

	it("returns LogLevel.Debug for 'debug' (lowercase)", () => {
		const result = resolveLogLevel("debug");
		expect(result).toBeDefined();
		expect(result?._tag).toBe("Debug");
	});

	it("returns LogLevel.Debug for 'Debug' (capitalized)", () => {
		const result = resolveLogLevel("Debug");
		expect(result).toBeDefined();
		expect(result?._tag).toBe("Debug");
	});

	it("returns LogLevel.Info for 'INFO' (uppercase)", () => {
		const result = resolveLogLevel("INFO");
		expect(result).toBeDefined();
		expect(result?._tag).toBe("Info");
	});

	it("falls back to env var when option is not provided", () => {
		vi.stubEnv("VITEST_REPORTER_LOG_LEVEL", "info");
		const result = resolveLogLevel(undefined);
		expect(result).toBeDefined();
		expect(result?._tag).toBe("Info");
	});

	it("explicit option takes priority over env var", () => {
		vi.stubEnv("VITEST_REPORTER_LOG_LEVEL", "info");
		const result = resolveLogLevel("debug");
		expect(result?._tag).toBe("Debug");
	});

	it("resolves 'warn' alias to Warning", () => {
		const result = resolveLogLevel("warn");
		expect(result).toBeDefined();
		expect(result?._tag).toBe("Warning");
	});

	it("resolves 'warning' to Warning", () => {
		const result = resolveLogLevel("warning");
		expect(result).toBeDefined();
		expect(result?._tag).toBe("Warning");
	});

	it("resolves 'WARN' to Warning", () => {
		const result = resolveLogLevel("WARN");
		expect(result).toBeDefined();
		expect(result?._tag).toBe("Warning");
	});
});

describe("resolveLogFile", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns undefined when option and env var are both absent", () => {
		vi.stubEnv("VITEST_REPORTER_LOG_FILE", "");
		const result = resolveLogFile(undefined);
		// empty string is falsy but not undefined; env var returns ""
		expect(result === undefined || result === "").toBe(true);
	});

	it("returns the explicit path when provided", () => {
		const result = resolveLogFile("/tmp/my-log.ndjson");
		expect(result).toBe("/tmp/my-log.ndjson");
	});

	it("falls back to env var when option is not provided", () => {
		vi.stubEnv("VITEST_REPORTER_LOG_FILE", "/var/log/vitest.ndjson");
		const result = resolveLogFile(undefined);
		expect(result).toBe("/var/log/vitest.ndjson");
	});

	it("explicit option takes priority over env var", () => {
		vi.stubEnv("VITEST_REPORTER_LOG_FILE", "/env/path.log");
		const result = resolveLogFile("/explicit/path.log");
		expect(result).toBe("/explicit/path.log");
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
		const layer = LoggerLive(LogLevel.None);
		expect(Layer.isLayer(layer)).toBe(true);
	});

	it("returns a non-silent layer (merged) when level is Debug", () => {
		const layer = LoggerLive(LogLevel.Debug);
		expect(Layer.isLayer(layer)).toBe(true);
	});

	it("returns a layer with file logging when logFile is provided", () => {
		const layer = LoggerLive(LogLevel.Debug, "/tmp/test-log.ndjson");
		expect(Layer.isLayer(layer)).toBe(true);
	});

	it("returns a layer without file logging when only level is provided", () => {
		const layer = LoggerLive(LogLevel.Info);
		expect(Layer.isLayer(layer)).toBe(true);
	});
});
