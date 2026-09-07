import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TestAnnotation, TestArtifact, TestAttachment } from "../src/schemas/TestArtifacts.js";

describe("TestArtifacts schemas", () => {
	it("accepts an arbitrary annotation type string", () => {
		const decoded = Schema.decodeUnknownSync(TestAnnotation)({
			type: "issues",
			message: "flaky under load",
			attachments: [],
		});
		expect(decoded.type).toBe("issues");
		expect(decoded.location).toBeUndefined();
	});

	it("carries an attachment descriptor with a byte size and no body", () => {
		const decoded = Schema.decodeUnknownSync(TestAttachment)({
			contentType: "image/png",
			path: ".vitest/attachments/shot-abc.png",
			byteSize: 40_000_000,
		});
		expect(decoded.body).toBeUndefined();
		expect(decoded.byteSize).toBe(40_000_000);
	});

	it("carries an artifact's custom fields as a JSON string", () => {
		const decoded = Schema.decodeUnknownSync(TestArtifact)({
			type: "my-pkg:trace",
			data: JSON.stringify({ spans: 3 }),
			attachments: [],
		});
		expect(JSON.parse(decoded.data ?? "{}")).toEqual({ spans: 3 });
	});
});
