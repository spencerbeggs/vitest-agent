import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { TerminalFormatter } from "../src/formatters/terminal.js";
import type { AgentReport } from "../src/schemas/AgentReport.js";

const reportWithFailingTest = (): AgentReport => ({
	timestamp: new Date().toISOString(),
	reason: "failed",
	project: "demo",
	summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 50 },
	failed: [
		{
			file: path.resolve(process.cwd(), "src/foo.test.ts"),
			state: "failed",
			tests: [
				{
					name: "does the thing",
					fullName: "Suite > does the thing",
					state: "failed",
					errors: [{ message: "expected ValidationError" }],
				},
			],
		},
	],
	unhandledErrors: [],
	failedFiles: ["src/foo.test.ts"],
});

describe("TerminalFormatter", () => {
	it("has format 'terminal'", () => {
		expect(TerminalFormatter.format).toBe("terminal");
	});

	it("emits OSC-8 hyperlinks with absolute file:// targets for failing test rows", () => {
		const outputs = TerminalFormatter.render([reportWithFailingTest()], {
			detail: "verbose",
			noColor: false,
			coverageConsoleLimit: 10,
		});
		expect(outputs).toHaveLength(1);
		const content = outputs[0].content;
		// OSC-8 sequence: ESC ] 8 ; ; <url> ESC \ <label> ESC ] 8 ; ; ESC \
		// File-URL paths must be absolute per RFC 8089 — three slashes
		// after `file:` confirms the leading `/` of an absolute path.
		expect(content).toContain("file:///");
		// Label keeps the project-relative path; only the link target
		// is absolute.
		expect(content).toContain("src/foo.test.ts");
	});

	it("does not emit OSC-8 escapes when noColor is set", () => {
		const outputs = TerminalFormatter.render([reportWithFailingTest()], {
			detail: "verbose",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC literally
		expect(outputs[0].content).not.toMatch(/\x1b\]8;/);
	});

	it("returns an empty array when no reports are provided", () => {
		// formatTerminal returns "" for empty reports; the formatter
		// must short-circuit to [] rather than emit a stdout entry
		// containing only an empty string.
		const outputs = TerminalFormatter.render([], {
			detail: "verbose",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(outputs).toEqual([]);
	});

	it("exercises the trendSummary conditional spread when defined", () => {
		// Covers the truthy branch of the
		//   ...(context.trendSummary !== undefined ? { trendSummary } : {})
		// spread on line 64 of terminal.ts. The spread runs whether or
		// not the underlying formatTerminal function ends up rendering
		// a trend line (the latter requires coverage data, which is
		// outside this formatter's responsibility); what matters here
		// is that the spread itself does not throw and that the
		// formatter still produces stdout output.
		const outputs = TerminalFormatter.render([reportWithFailingTest()], {
			detail: "verbose",
			noColor: true,
			coverageConsoleLimit: 10,
			trendSummary: { direction: "improving", runCount: 7 },
		});
		expect(outputs).toHaveLength(1);
		expect(outputs[0].target).toBe("stdout");
	});

	it("exercises the mcp conditional spread when defined", () => {
		// Covers the truthy branch of the
		//   ...(context.mcp !== undefined ? { mcp } : {})
		// spread on line 65 of terminal.ts. With mcp=true, formatTerminal
		// appends MCP-tool hints to the failures block, which lets us
		// verify the value reaches the underlying function rather than
		// being dropped by a faulty spread.
		const outputs = TerminalFormatter.render([reportWithFailingTest()], {
			detail: "verbose",
			noColor: true,
			coverageConsoleLimit: 10,
			mcp: true,
		});
		expect(outputs).toHaveLength(1);
		expect(outputs[0].content).toContain("MCP tool");
	});
});
