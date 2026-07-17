import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { effectToZodSchema } from "../src/utils/effect-to-zod.js";

describe("effectToZodSchema", () => {
	it("converts a flat Schema.Struct to a zod schema that validates matching input", () => {
		const E = Schema.Struct({ project: Schema.String, count: Schema.Number });
		const z = effectToZodSchema(E);
		expect(z.safeParse({ project: "p", count: 5 }).success).toBe(true);
	});

	it("rejects input the source Effect Schema would also reject", () => {
		const E = Schema.Struct({ project: Schema.String, count: Schema.Number });
		const z = effectToZodSchema(E);
		expect(z.safeParse({ project: "p", count: "not-a-number" }).success).toBe(false);
		expect(z.safeParse({ project: "p" }).success).toBe(false);
	});

	it("preserves arrays of nested objects through the round-trip", () => {
		const E = Schema.Struct({
			errors: Schema.Array(
				Schema.Struct({
					id: Schema.Number,
					name: Schema.NullOr(Schema.String),
				}),
			),
		});
		const z = effectToZodSchema(E);
		expect(
			z.safeParse({
				errors: [
					{ id: 1, name: "AssertionError" },
					{ id: 2, name: null },
				],
			}).success,
		).toBe(true);
	});

	it("respects Schema.NullOr — the produced zod accepts both the inner type and null", () => {
		const E = Schema.Struct({ branch: Schema.NullOr(Schema.String) });
		const z = effectToZodSchema(E);
		expect(z.safeParse({ branch: "main" }).success).toBe(true);
		expect(z.safeParse({ branch: null }).success).toBe(true);
		expect(z.safeParse({ branch: 42 }).success).toBe(false);
	});

	it("respects Schema.optional — the produced zod tolerates the field being absent", () => {
		const E = Schema.Struct({ project: Schema.String, errorName: Schema.optional(Schema.String) });
		const z = effectToZodSchema(E);
		expect(z.safeParse({ project: "p" }).success).toBe(true);
		expect(z.safeParse({ project: "p", errorName: "AssertionError" }).success).toBe(true);
	});

	it("respects literal unions", () => {
		const E = Schema.Struct({ scope: Schema.Literals(["test", "suite", "module", "unhandled"]) });
		const z = effectToZodSchema(E);
		expect(z.safeParse({ scope: "test" }).success).toBe(true);
		expect(z.safeParse({ scope: "bogus" }).success).toBe(false);
	});

	it("preserves Schema annotations (title, description, examples) through the bridge", async () => {
		const z3 = await import("zod");
		const E = Schema.Struct({
			project: Schema.String.annotate({
				title: "Project name",
				description: "Workspace project key the run was attributed to.",
				examples: ["playground", "@org/pkg"],
			}),
			count: Schema.Number.annotate({ description: "Total error rows." }),
		}).annotate({ title: "TestErrorsResult", description: "Top-level test_errors payload." });
		const zodified = effectToZodSchema(E);
		const json = z3.z.toJSONSchema(zodified) as {
			title?: string;
			description?: string;
			properties?: Record<string, { title?: string; description?: string; examples?: ReadonlyArray<unknown> }>;
		};
		expect(json.title).toBe("TestErrorsResult");
		expect(json.description).toBe("Top-level test_errors payload.");
		expect(json.properties?.project?.title).toBe("Project name");
		expect(json.properties?.project?.description).toContain("Workspace project key");
		expect(json.properties?.project?.examples).toEqual(["playground", "@org/pkg"]);
		expect(json.properties?.count?.description).toBe("Total error rows.");
	});
});
