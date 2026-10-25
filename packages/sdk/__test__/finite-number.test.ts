/**
 * Every numeric field that reaches `schemas/5.0/run.json` is declared with
 * `FiniteNumber`, so the published JSON Schema says `{ "type": "number" }`
 * and never the `"Infinity"` / `"-Infinity"` / `"NaN"` string arms
 * `Schema.Number` lowers to (issue #392). Pinned at three levels: the
 * shared schema's own decode behaviour, the document the `RunReportFile`
 * schema generates today, and the committed document on disk.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { FiniteNumber } from "../src/schemas/Common.js";
import { RunReportFile } from "../src/schemas/RunReportFile.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Every JSON pointer whose node is an `enum` containing the non-finite spellings. */
const nonFiniteArms = (node: unknown, path = ""): string[] => {
	if (node === null || typeof node !== "object") return [];
	const record = node as Record<string, unknown>;
	const own = Array.isArray(record.enum) && record.enum.includes("Infinity") ? [path] : [];
	return own.concat(...Object.entries(record).map(([key, child]) => nonFiniteArms(child, `${path}/${key}`)));
};

/** Every JSON pointer whose node is a bare `{ "type": "number" }`. */
const numberNodes = (node: unknown, path = ""): string[] => {
	if (node === null || typeof node !== "object") return [];
	const record = node as Record<string, unknown>;
	const own = record.type === "number" ? [path] : [];
	return own.concat(...Object.entries(record).map(([key, child]) => numberNodes(child, `${path}/${key}`)));
};

describe("FiniteNumber", () => {
	it("decodes finite values exactly as Schema.Number did", () => {
		const decode = Schema.decodeUnknownSync(FiniteNumber);
		expect(decode(0)).toBe(0);
		expect(decode(-3)).toBe(-3);
		expect(decode(42.5)).toBe(42.5);
		expect(decode(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("rejects NaN and the infinities as typed decode failures", () => {
		const decode = Schema.decodeUnknownSync(FiniteNumber);
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "Infinity"]) {
			expect(() => decode(value)).toThrow();
		}
	});

	it("lowers to a bare number type with no non-finite string arm", () => {
		const document = Schema.toJsonSchemaDocument(FiniteNumber);
		expect(document.schema).toEqual({ type: "number" });
		// Control: the bare `Schema.Number` the sdk no longer uses still
		// carries the arms, so a walker that found none above found none
		// because there are none, not because it cannot see them.
		const control = Schema.toJsonSchemaDocument(Schema.Number);
		expect(nonFiniteArms(control.schema)).toEqual(["/anyOf/1"]);
	});
});

describe("run.json numeric fields", () => {
	it("generate no non-finite string arm anywhere in the RunReportFile document", () => {
		const document = Schema.toJsonSchemaDocument(RunReportFile, { onExcessProperty: "ignore" });
		expect(nonFiniteArms(document)).toEqual([]);
		// Non-vacuity: the summary counts are still numbers in the document.
		expect(numberNodes(document).length).toBeGreaterThanOrEqual(33);
	});

	it("carry no non-finite string arm in the committed schemas/5.0/run.json", () => {
		const document = JSON.parse(readFileSync(`${repoRoot}schemas/5.0/run.json`, "utf-8")) as unknown;
		expect(nonFiniteArms(document)).toEqual([]);
		expect(numberNodes(document)).toContain("/$defs/ReportSummary/properties/total");
	});
});
