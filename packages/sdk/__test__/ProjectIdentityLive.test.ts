import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ProjectIdentityNotResolvableError } from "../src/errors/ProjectIdentityError.js";
import { ProjectIdentityTest } from "../src/layers/ProjectIdentityLive.js";
import { ProjectIdentity } from "../src/services/ProjectIdentity.js";

describe("ProjectIdentityTest layer", () => {
	it("returns the configured ResolvedIdentity from resolve()", async () => {
		const fixed = {
			projectKey: "github.com__foo__bar",
			canonicalForm: "github.com/foo/bar",
			source: "git-remote" as const,
		};
		const program = Effect.gen(function* () {
			const id = yield* ProjectIdentity;
			return yield* id.resolve("/whatever");
		}).pipe(Effect.provide(ProjectIdentityTest(fixed)));

		const result = await Effect.runPromise(program);
		expect(result).toEqual(fixed);
	});

	it("propagates ProjectIdentityNotResolvableError when configured to fail", async () => {
		const error = new ProjectIdentityNotResolvableError({
			tried: [{ source: "explicit", reason: "not configured" }],
		});
		const program = Effect.gen(function* () {
			const id = yield* ProjectIdentity;
			return yield* id.resolve("/whatever");
		}).pipe(Effect.provide(ProjectIdentityTest(error)));

		await expect(Effect.runPromise(program)).rejects.toThrow(/Project identity could not be resolved/);
	});

	it("ignores the workspaceRoot argument when fed a fixed result", async () => {
		const fixed = {
			projectKey: "explicit-key",
			canonicalForm: "explicit-key",
			source: "explicit" as const,
		};
		const program = Effect.gen(function* () {
			const id = yield* ProjectIdentity;
			const a = yield* id.resolve("/path/a");
			const b = yield* id.resolve("/path/b");
			return [a, b];
		}).pipe(Effect.provide(ProjectIdentityTest(fixed)));

		const [a, b] = await Effect.runPromise(program);
		expect(a).toEqual(b);
	});
});
