import { describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../src/utils/configuration-error.js";
import { assertFlatScope, createReportWriter } from "../src/utils/report-writer.js";

describe("createReportWriter", () => {
	it("creates the report handle lazily, on the first write", async () => {
		let created = 0;
		const written: Array<[string, string]> = [];
		const vitest = {
			createReport: (scope: string) => {
				created++;
				expect(scope).toBe("vitest-agent");
				return {
					writeFile: async (filename: string, content: string) => {
						written.push([filename, content]);
					},
				};
			},
		};
		const writer = createReportWriter(vitest, "vitest-agent");
		expect(created).toBe(0);
		writer.write("run.json", "{}");
		expect(created).toBe(1);
		writer.write("summary.md", "# x");
		expect(created).toBe(1);
		await writer.flush();
		expect(written).toEqual([
			["run.json", "{}"],
			["summary.md", "# x"],
		]);
	});

	it("never calls clean", () => {
		let cleaned = 0;
		const vitest = {
			createReport: () => ({
				clean: async () => {
					cleaned++;
				},
				writeFile: async () => {},
			}),
		};
		const writer = createReportWriter(vitest, "vitest-agent");
		writer.write("run.json", "{}");
		expect(cleaned).toBe(0);
	});

	it("fails loudly when the Vitest instance has no createReport", () => {
		const writer = createReportWriter({}, "vitest-agent");
		expect(() => writer.write("run.json", "{}")).toThrow(/requires Vitest 5/);
	});

	it("swallows a write rejection so a report failure cannot fail the run", async () => {
		// The failure is reported on stderr, not thrown — capture it so the
		// diagnostic does not leak into the suite's own output.
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			const writer = createReportWriter(
				{ createReport: () => ({ writeFile: async () => Promise.reject(new Error("ENOSPC")) }) },
				"vitest-agent",
			);
			writer.write("run.json", "{}");
			await expect(writer.flush()).resolves.toBeUndefined();
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining("report file run.json not written"));
		} finally {
			stderr.mockRestore();
		}
	});

	it.each(["nested/run.json", "nested\\run.json", "../escape.json", "a/../../b.json"])(
		"rejects the unsafe filename %s",
		(filename) => {
			const writer = createReportWriter({ createReport: () => ({ writeFile: async () => {} }) }, "vitest-agent");
			expect(() => writer.write(filename, "{}")).toThrow(new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
			// A bad filename is a user configuration mistake, not an internal
			// bug — it must carry the ConfigurationError marker so the
			// plugin's catch reports it without a stack or issue banner.
			expect(() => writer.write(filename, "{}")).toThrow(ConfigurationError);
		},
	);

	it("rejects an unsafe report scope with a ConfigurationError", () => {
		expect(() => assertFlatScope("../escape")).toThrow(ConfigurationError);
		expect(() => assertFlatScope("../escape")).toThrow(/report scope "\.\.\/escape"/);
	});

	it("accepts a flat filename that merely contains dots", () => {
		const writer = createReportWriter({ createReport: () => ({ writeFile: async () => {} }) }, "vitest-agent");
		expect(() => writer.write("run..2.json", "{}")).not.toThrow();
	});
});
