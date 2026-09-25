/**
 * End-to-end regression guard for `--version`.
 *
 * `bin.ts` is a thin shim over `main.ts`, which passes `CURRENT_CLI_VERSION`
 * (a build-time literal read from `package.json#version`) into
 * `Command.run`. The carrier (`@vitest-agent/plugin`) calls the same
 * `main()` with its own `distribution`, which `--version` appends as
 * ` via <name> <version>`. Spawns the built dev output.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CliTest } from "@effected/cli/testing";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import { DIST, inSandbox, runCli } from "../utils/cli-test.js";

describe("vitest-agent CLI --version", () => {
	it("prints exactly `vitest-agent <version>` on stdout for a direct install", async () => {
		const result = await runCli(["--version"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(`vitest-agent ${packageJson.version}\n`);
		expect(result.stderr).toBe("");
	});

	it("appends the carrier's distribution when main() is given one", async () => {
		const result = await inSandbox((sandbox) => {
			const shim = join(sandbox.root, "carrier-shim.mjs");
			writeFileSync(
				shim,
				`import { main } from ${JSON.stringify(pathToFileURL(join(DIST, "main.js")).href)};\n` +
					`main({ distribution: { name: "@vitest-agent/plugin", version: "9.9.9" } });\n`,
			);
			return CliTest.run(shim, ["--version"], { sandbox, execPath: process.execPath });
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(`vitest-agent ${packageJson.version} via @vitest-agent/plugin 9.9.9\n`);
		expect(result.stderr).toBe("");
	});
});
