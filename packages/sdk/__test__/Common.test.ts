import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	ConsoleOutputMode,
	ConsoleStrategy,
	DetailLevel,
	Environment,
	Executor,
	OutputFormat,
	PackageManager,
	PluginMode,
	ReportError,
	TestClassification,
	TestRunReason,
	TestState,
} from "../src/schemas/Common.js";

describe("TestState", () => {
	it("accepts valid values", () => {
		for (const value of ["passed", "failed", "skipped", "pending"]) {
			expect(Schema.decodeUnknownSync(TestState)(value)).toBe(value);
		}
	});

	it("rejects invalid values", () => {
		expect(() => Schema.decodeUnknownSync(TestState)("invalid")).toThrow();
	});
});

describe("TestRunReason", () => {
	it("accepts valid values", () => {
		for (const value of ["passed", "failed", "interrupted"]) {
			expect(Schema.decodeUnknownSync(TestRunReason)(value)).toBe(value);
		}
	});

	it("rejects invalid values", () => {
		expect(() => Schema.decodeUnknownSync(TestRunReason)("unknown")).toThrow();
	});
});

describe("TestClassification", () => {
	it("accepts valid values", () => {
		for (const value of ["stable", "new-failure", "persistent", "flaky", "recovered"]) {
			expect(Schema.decodeUnknownSync(TestClassification)(value)).toBe(value);
		}
	});

	it("rejects invalid values", () => {
		expect(() => Schema.decodeUnknownSync(TestClassification)("bad")).toThrow();
	});
});

describe("ConsoleOutputMode", () => {
	it("accepts valid values", () => {
		for (const value of ["failures", "full", "silent"]) {
			expect(Schema.decodeUnknownSync(ConsoleOutputMode)(value)).toBe(value);
		}
	});

	it("rejects invalid values", () => {
		expect(() => Schema.decodeUnknownSync(ConsoleOutputMode)("verbose")).toThrow();
	});
});

describe("PluginMode", () => {
	it("accepts valid values", () => {
		for (const value of ["auto", "agent", "silent"]) {
			expect(Schema.decodeUnknownSync(PluginMode)(value)).toBe(value);
		}
	});

	it("rejects invalid values", () => {
		expect(() => Schema.decodeUnknownSync(PluginMode)("manual")).toThrow();
	});
});

describe("ConsoleStrategy", () => {
	it("accepts valid values", () => {
		for (const value of ["own", "complement"]) {
			expect(Schema.decodeUnknownSync(ConsoleStrategy)(value)).toBe(value);
		}
	});

	it("rejects invalid values", () => {
		expect(() => Schema.decodeUnknownSync(ConsoleStrategy)("other")).toThrow();
	});
});

describe("PackageManager", () => {
	it("accepts valid values", () => {
		for (const value of ["pnpm", "npm", "yarn", "bun"]) {
			expect(Schema.decodeUnknownSync(PackageManager)(value)).toBe(value);
		}
	});

	it("rejects invalid values", () => {
		expect(() => Schema.decodeUnknownSync(PackageManager)("deno")).toThrow();
	});
});

describe("Environment", () => {
	it("accepts valid environments", () => {
		expect(Schema.decodeUnknownSync(Environment)("agent-shell")).toBe("agent-shell");
		expect(Schema.decodeUnknownSync(Environment)("terminal")).toBe("terminal");
		expect(Schema.decodeUnknownSync(Environment)("ci-github")).toBe("ci-github");
		expect(Schema.decodeUnknownSync(Environment)("ci-generic")).toBe("ci-generic");
	});
});

describe("Executor", () => {
	it("accepts valid executors", () => {
		expect(Schema.decodeUnknownSync(Executor)("human")).toBe("human");
		expect(Schema.decodeUnknownSync(Executor)("agent")).toBe("agent");
		expect(Schema.decodeUnknownSync(Executor)("ci")).toBe("ci");
	});
});

describe("OutputFormat", () => {
	it("accepts valid formats", () => {
		expect(Schema.decodeUnknownSync(OutputFormat)("markdown")).toBe("markdown");
		expect(Schema.decodeUnknownSync(OutputFormat)("json")).toBe("json");
		expect(Schema.decodeUnknownSync(OutputFormat)("vitest-bypass")).toBe("vitest-bypass");
		expect(Schema.decodeUnknownSync(OutputFormat)("silent")).toBe("silent");
	});
});

describe("DetailLevel", () => {
	it("accepts valid detail levels", () => {
		expect(Schema.decodeUnknownSync(DetailLevel)("minimal")).toBe("minimal");
		expect(Schema.decodeUnknownSync(DetailLevel)("neutral")).toBe("neutral");
		expect(Schema.decodeUnknownSync(DetailLevel)("standard")).toBe("standard");
		expect(Schema.decodeUnknownSync(DetailLevel)("verbose")).toBe("verbose");
	});
});

describe("ReportError", () => {
	it("accepts a minimal error with only message", () => {
		const result = Schema.decodeUnknownSync(ReportError)({ message: "test error" });
		expect(result).toEqual({ message: "test error" });
	});

	it("accepts a full error with all fields", () => {
		const input = {
			message: "Expected 1 to be 2",
			stack: "Error: Expected 1 to be 2\n  at ...",
			diff: "- Expected\n+ Received\n- 2\n+ 1",
		};
		const result = Schema.decodeUnknownSync(ReportError)(input);
		expect(result).toEqual(input);
	});

	it("rejects missing message", () => {
		expect(() => Schema.decodeUnknownSync(ReportError)({ stack: "trace" })).toThrow();
	});

	it("rejects non-string message", () => {
		expect(() => Schema.decodeUnknownSync(ReportError)({ message: 42 })).toThrow();
	});
});
