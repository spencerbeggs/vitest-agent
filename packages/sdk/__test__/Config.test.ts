import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { RunRetentionPolicy, VitestAgentConfig } from "../src/schemas/Config.js";

const decode = (input: unknown) => Effect.runPromise(Schema.decodeUnknownEffect(VitestAgentConfig)(input));

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

describe("VitestAgentConfig.retention", () => {
	it("decodes an empty retention table", async () => {
		const result = await decode({ retention: {} });
		expect(result.retention).toBeDefined();
		expect(result.retention?.keepRuns).toBeUndefined();
	});

	it("decodes keepRuns, maxAgeDays and enabled", async () => {
		const result = await decode({ retention: { enabled: true, keepRuns: 50, maxAgeDays: 30 } });
		expect(result.retention?.enabled).toBe(true);
		expect(result.retention?.keepRuns).toBe(50);
		expect(result.retention?.maxAgeDays).toBe(30);
	});

	it("rejects a zero or fractional keepRuns and a negative maxAgeDays", async () => {
		await expect(decode({ retention: { keepRuns: 0 } })).rejects.toThrow();
		await expect(decode({ retention: { keepRuns: 2.5 } })).rejects.toThrow();
		await expect(decode({ retention: { maxAgeDays: -1 } })).rejects.toThrow();
	});
});

describe("RunRetentionPolicy.fromConfig", () => {
	it("defaults to keepRuns 200 and no age limit when the table is absent", () => {
		const policy = RunRetentionPolicy.fromConfig(new VitestAgentConfig({}));
		if (Option.isSome(policy)) {
			expect(policy.value.keepRuns).toBe(RunRetentionPolicy.DEFAULT_KEEP_RUNS);
			expect(policy.value.keepRuns).toBe(200);
			expect(policy.value.maxAgeDays).toBeUndefined();
		} else {
			expect.fail("expected a policy");
		}
	});

	it("is none when retention.enabled is false", async () => {
		const config = await decode({ retention: { enabled: false, keepRuns: 5 } });
		expect(Option.isNone(RunRetentionPolicy.fromConfig(config))).toBe(true);
	});

	it("carries the configured keepRuns and maxAgeDays", async () => {
		const config = await decode({ retention: { keepRuns: 7, maxAgeDays: 14 } });
		const policy = RunRetentionPolicy.fromConfig(config);
		if (Option.isSome(policy)) {
			expect(policy.value.keepRuns).toBe(7);
			expect(policy.value.maxAgeDays).toBe(14);
		} else {
			expect.fail("expected a policy");
		}
	});

	it("keeps the default keepRuns when only maxAgeDays is configured", async () => {
		const config = await decode({ retention: { maxAgeDays: 14 } });
		const policy = RunRetentionPolicy.fromConfig(config);
		if (Option.isSome(policy)) {
			expect(policy.value.keepRuns).toBe(200);
			expect(policy.value.maxAgeDays).toBe(14);
		} else {
			expect.fail("expected a policy");
		}
	});
});
