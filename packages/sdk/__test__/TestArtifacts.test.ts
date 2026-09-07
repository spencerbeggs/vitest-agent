import { Exit, Schema } from "effect";
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

	it("accepts an attachment with a utf-8 body encoding", () => {
		const decoded = Schema.decodeUnknownSync(TestAttachment)({
			body: "hello world",
			bodyEncoding: "utf-8",
			byteSize: 11,
		});
		expect(decoded.bodyEncoding).toBe("utf-8");
	});

	it("rejects an attachment with an unsupported body encoding", () => {
		const exit = Schema.decodeUnknownExit(TestAttachment)({
			body: "aGVsbG8=",
			bodyEncoding: "hex",
			byteSize: 5,
		});
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("rejects an annotation missing its message", () => {
		const exit = Schema.decodeUnknownExit(TestAnnotation)({
			type: "issues",
			attachments: [],
		});
		expect(Exit.isFailure(exit)).toBe(true);
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
