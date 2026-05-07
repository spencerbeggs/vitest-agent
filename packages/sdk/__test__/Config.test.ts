import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { VitestAgentConfig } from "../src/schemas/Config.js";

const decode = (input: unknown) => Effect.runPromise(Schema.decodeUnknown(VitestAgentConfig)(input));

describe("VitestAgentConfig", () => {
	it("decodes an empty object", async () => {
		const result = await decode({});
		expect(result.cacheDir).toBeUndefined();
		expect(result.projectKey).toBeUndefined();
	});

	it("decodes a cacheDir override", async () => {
		const result = await decode({ cacheDir: "/tmp/foo" });
		expect(result.cacheDir).toBe("/tmp/foo");
		expect(result.projectKey).toBeUndefined();
	});

	it("decodes a projectKey override", async () => {
		const result = await decode({ projectKey: "my-app" });
		expect(result.projectKey).toBe("my-app");
		expect(result.cacheDir).toBeUndefined();
	});

	it("decodes both fields", async () => {
		const result = await decode({ cacheDir: "/tmp/foo", projectKey: "my-app" });
		expect(result.cacheDir).toBe("/tmp/foo");
		expect(result.projectKey).toBe("my-app");
	});

	it("rejects non-string cacheDir", async () => {
		await expect(decode({ cacheDir: 42 })).rejects.toThrow();
	});

	it("rejects non-string projectKey", async () => {
		await expect(decode({ projectKey: ["nope"] })).rejects.toThrow();
	});
});
