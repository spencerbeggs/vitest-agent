import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunEvent, VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { afterAll, describe, expect, it } from "vitest";
import { AgentReporter, toAnnotationInputs, toArtifactInputs } from "../src/reporter.js";

const scratch = mkdtempSync(join(tmpdir(), "va-annotations-"));
afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe("annotation and artifact ingestion mappers", () => {
	it("maps an annotation with a location and an inline attachment", () => {
		const inputs = toAnnotationInputs(7, [
			{
				type: "issues",
				message: "known slow",
				location: { file: "src/a.test.ts", line: 4, column: 1 },
				attachment: { contentType: "text/plain", body: "hi" },
			},
		]);
		expect(inputs).toEqual([
			{
				testCaseId: 7,
				type: "issues",
				message: "known slow",
				locationFile: "src/a.test.ts",
				locationLine: 4,
				locationColumn: 1,
				attachments: [{ contentType: "text/plain", body: "hi", byteSize: 2 }],
			},
		]);
	});

	it("defaults a typeless annotation to notice and tolerates no attachment", () => {
		const inputs = toAnnotationInputs(1, [{ message: "plain" }]);
		expect(inputs[0]?.type).toBe("notice");
		expect(inputs[0]?.attachments).toEqual([]);
	});

	it("carries a declared utf-8 body encoding through and sizes the decoded bytes", () => {
		const inputs = toAnnotationInputs(1, [{ message: "m", attachment: { body: "héllo", bodyEncoding: "utf-8" } }]);
		expect(inputs[0]?.attachments).toEqual([{ body: "héllo", bodyEncoding: "utf-8", byteSize: 6 }]);
	});

	it("sizes a declared base64 body by its decoded byte length", () => {
		const inputs = toAnnotationInputs(1, [
			{ message: "m", attachment: { contentType: "image/png", body: "AAAA", bodyEncoding: "base64" } },
		]);
		expect(inputs[0]?.attachments).toEqual([
			{ contentType: "image/png", body: "AAAA", bodyEncoding: "base64", byteSize: 3 },
		]);
	});

	it("base64-encodes a binary body and records the raw byte length", () => {
		const inputs = toAnnotationInputs(1, [
			{ message: "m", attachment: { contentType: "image/png", body: new Uint8Array([1, 2, 3]) } },
		]);
		expect(inputs[0]?.attachments).toEqual([
			{
				contentType: "image/png",
				body: Buffer.from([1, 2, 3]).toString("base64"),
				bodyEncoding: "base64",
				byteSize: 3,
			},
		]);
	});

	it("skips internal artifact types", () => {
		const inputs = toArtifactInputs(2, [
			{ type: "internal:annotation" },
			{ type: "my-pkg:trace", spans: 3, attachments: [] },
		]);
		expect(inputs).toHaveLength(1);
		expect(inputs[0]?.type).toBe("my-pkg:trace");
		expect(JSON.parse(inputs[0]?.data ?? "{}")).toEqual({ spans: 3 });
	});

	it("maps an artifact's message, location and attachments", () => {
		const inputs = toArtifactInputs(9, [
			{
				type: "my-pkg:shot",
				message: "diff exceeded",
				location: { file: "src/b.test.ts", line: 12, column: 3 },
				attachments: [{ contentType: "text/plain", body: "abc" }],
			},
		]);
		expect(inputs).toEqual([
			{
				testCaseId: 9,
				type: "my-pkg:shot",
				message: "diff exceeded",
				locationFile: "src/b.test.ts",
				locationLine: 12,
				locationColumn: 3,
				attachments: [{ contentType: "text/plain", body: "abc", byteSize: 3 }],
			},
		]);
	});

	it("records a path attachment's size without a body", () => {
		const inputs = toArtifactInputs(3, [
			{
				type: "my-pkg:shot",
				attachments: [{ contentType: "image/png", path: ".vitest/attachments/s.png" }],
			},
		]);
		expect(inputs[0]?.attachments).toEqual([
			{ contentType: "image/png", path: ".vitest/attachments/s.png", byteSize: 0 },
		]);
	});

	it("reads an existing path attachment's size from disk", () => {
		const file = join(scratch, "shot.bin");
		writeFileSync(file, Buffer.alloc(11));
		const inputs = toArtifactInputs(3, [{ type: "my-pkg:shot", attachments: [{ path: file }] }]);
		expect(inputs[0]?.attachments).toEqual([{ path: file, byteSize: 11 }]);
	});

	it("drops an artifact carrying no usable type", () => {
		expect(toArtifactInputs(4, [{ spans: 1 }])).toEqual([]);
	});
});

interface AnnotationFixture {
	message: string;
	type?: string;
	location?: { file: string; line: number; column: number };
	attachment?: { contentType?: string; path?: string; body?: string | Uint8Array };
}

function makeTestCase(
	name: string,
	annotations: Array<AnnotationFixture>,
	artifacts: Array<Record<string, unknown>>,
): VitestTestCase {
	return {
		type: "test",
		name,
		fullName: name,
		tags: [],
		result: () => ({ state: "passed" }),
		diagnostic: () => ({ duration: 1, flaky: false, slow: false }),
		annotations: () => annotations,
		artifacts: () => artifacts,
	} as unknown as VitestTestCase;
}

function makeTestModule(tests: Array<VitestTestCase>): VitestTestModule {
	return {
		type: "module",
		moduleId: "/abs/src/foo.test.ts",
		relativeModuleId: "src/foo.test.ts",
		project: { name: "" },
		state: () => "passed",
		children: {
			*allTests() {
				for (const t of tests) yield t;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 5 }),
		errors: () => [],
	} as unknown as VitestTestModule;
}

describe("onTestRunEnd annotation and artifact ingestion", () => {
	it("persists each test case's annotations and artifacts against its own row", async () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "va-ingest-"));
		const reporter = new AgentReporter({ cacheDir, format: "silent" });
		const modules = [
			makeTestModule([
				makeTestCase(
					"first",
					[{ message: "slow one", type: "issues", location: { file: "src/foo.test.ts", line: 3, column: 2 } }],
					[{ type: "internal:annotation" }],
				),
				makeTestCase(
					"second",
					[],
					[{ type: "my-pkg:trace", spans: 2, attachments: [{ contentType: "text/plain", body: "abc" }] }],
				),
			]),
		];
		await reporter.onTestRunEnd(modules, [], "passed");

		const db = new DatabaseSync(join(cacheDir, "data.db"), { readOnly: true });
		try {
			const annotations = db
				.prepare(
					"SELECT tc.name AS name, a.type AS type, a.message AS message, a.location_line AS line, f.path AS file FROM test_annotations a JOIN test_cases tc ON tc.id = a.test_case_id LEFT JOIN files f ON f.id = a.location_file_id",
				)
				.all();
			expect(annotations).toEqual([
				{ name: "first", type: "issues", message: "slow one", line: 3, file: "src/foo.test.ts" },
			]);

			const artifacts = db
				.prepare(
					"SELECT tc.name AS name, ar.type AS type, ar.data AS data FROM test_artifacts ar JOIN test_cases tc ON tc.id = ar.test_case_id",
				)
				.all();
			expect(artifacts).toEqual([{ name: "second", type: "my-pkg:trace", data: JSON.stringify({ spans: 2 }) }]);

			const attachments = db
				.prepare("SELECT content_type AS contentType, body, byte_size AS byteSize FROM attachments")
				.all();
			expect(attachments).toEqual([{ contentType: "text/plain", body: "abc", byteSize: 3 }]);
		} finally {
			db.close();
			rmSync(cacheDir, { recursive: true, force: true });
		}
	});
});

describe("streaming annotation and artifact hooks", () => {
	const streamingReporter = (events: Array<RunEvent>) =>
		new AgentReporter({
			cacheDir: scratch,
			format: "silent",
			onRunEvent: (e) => events.push(e),
		});
	const fakeCase = { name: "my test", module: { relativeModuleId: "src/foo.test.ts" } };

	it("carries the annotation type, location and attachments onto TestAnnotated", () => {
		const events: Array<RunEvent> = [];
		streamingReporter(events).onTestCaseAnnotate(fakeCase, {
			message: "known slow",
			type: "issues",
			location: { file: "src/foo.test.ts", line: 4, column: 1 },
			attachment: { contentType: "text/plain", body: "hi" },
		});
		expect(events).toEqual([
			{
				_tag: "TestAnnotated",
				modulePath: "src/foo.test.ts",
				testName: "my test",
				suitePath: [],
				annotation: "known slow",
				annotationType: "issues",
				location: { file: "src/foo.test.ts", line: 4, column: 1 },
				attachments: [{ contentType: "text/plain", body: "hi", byteSize: 2 }],
			},
		]);
	});

	it("defaults a typeless annotation to notice", () => {
		const events: Array<RunEvent> = [];
		streamingReporter(events).onTestCaseAnnotate(fakeCase, { message: "plain" });
		expect(events[0]).toMatchObject({ annotationType: "notice", attachments: [] });
		expect(events[0]).not.toHaveProperty("location");
	});

	it("carries the artifact location and attachments onto TestArtifactRecorded", () => {
		const events: Array<RunEvent> = [];
		streamingReporter(events).onTestCaseArtifactRecord(fakeCase, {
			type: "my-pkg:shot",
			location: { file: "src/foo.test.ts", line: 9, column: 2 },
			attachments: [{ contentType: "image/png", path: ".vitest/attachments/s.png" }],
		});
		expect(events).toEqual([
			{
				_tag: "TestArtifactRecorded",
				modulePath: "src/foo.test.ts",
				testName: "my test",
				suitePath: [],
				artifact: "my-pkg:shot",
				location: { file: "src/foo.test.ts", line: 9, column: 2 },
				attachments: [{ contentType: "image/png", path: ".vitest/attachments/s.png", byteSize: 0 }],
			},
		]);
	});

	it("emits nothing for a reserved internal artifact type", () => {
		const events: Array<RunEvent> = [];
		const reporter = streamingReporter(events);
		reporter.onTestCaseArtifactRecord(fakeCase, { type: "internal:annotation" });
		reporter.onTestCaseArtifactRecord(fakeCase, {});
		expect(events).toEqual([]);
	});
});
