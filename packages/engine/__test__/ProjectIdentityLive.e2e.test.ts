import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { WorkspaceDiscovery } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigLive } from "../src/layers/ConfigLive.js";
import { ProjectIdentityLive } from "../src/layers/ProjectIdentityLive.js";
import { ProjectIdentity } from "../src/services/ProjectIdentity.js";

/**
 * The git-remote identity source against real git. The project key derived
 * from it names the `data.db` directory, so it must be read exactly as 2.x
 * read it: the RAW `remote.origin.url` (`git config --get`), never the
 * `url.<base>.insteadOf`-rewritten URL `git remote get-url` reports.
 */
const git = (cwd: string, ...args: ReadonlyArray<string>) =>
	execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();

const noPackages = WorkspaceDiscovery.layerTest({ listPackagesIn: () => Effect.succeed([]) });

const resolveIn = (dir: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const id = yield* ProjectIdentity;
			return yield* id.resolve(dir);
		}).pipe(
			Effect.provide(
				ProjectIdentityLive.pipe(
					Layer.provide(
						Layer.mergeAll(NodeServices.layer, noPackages, ConfigLive(dir).pipe(Layer.provide(NodeServices.layer))),
					),
				),
			),
		),
	);

let dir: string;
beforeEach(() => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "va-identity-")));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("ProjectIdentityLive git remote (real git)", () => {
	it("keys off the raw remote.origin.url, ignoring an insteadOf rewrite", async () => {
		git(dir, "init", "-q");
		git(dir, "remote", "add", "origin", "https://github.com/foo/bar.git");
		git(dir, "config", "url.https://gitlab.example.com/.insteadOf", "https://github.com/");
		// Control: the rewrite is live, so `git remote get-url` would key differently.
		expect(git(dir, "remote", "get-url", "origin")).toBe("https://gitlab.example.com/foo/bar.git");

		const identity = await resolveIn(dir);
		expect(identity).toMatchObject({ source: "git-remote", projectKey: "github.com__foo__bar" });
	});

	it("a repository with no origin remote has no git-remote source", async () => {
		git(dir, "init", "-q");
		await expect(resolveIn(dir)).rejects.toMatchObject({ _tag: "ProjectIdentityNotResolvableError" });
	});

	it("a directory that is not a git checkout has no git-remote source", async () => {
		await expect(resolveIn(dir)).rejects.toMatchObject({ _tag: "ProjectIdentityNotResolvableError" });
	});
});
