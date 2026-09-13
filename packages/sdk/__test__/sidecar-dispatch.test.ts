import { describe, expect, it } from "vitest";
import type { DispatchIo } from "../src/sidecar-dispatch.js";
import { dispatch } from "../src/sidecar-dispatch.js";

const cwd = "/repo";

/** In-memory io: `files` maps absolute paths to contents; anything else throws. */
const ioFor = (
	env: Record<string, string | undefined>,
	files: Record<string, string> = {},
	ioCwd: string = cwd,
): DispatchIo => ({
	cwd: ioCwd,
	env,
	readFile: (path) => {
		const contents = files[path];
		if (contents === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
		return contents;
	},
});

const packageJson = (scripts: Record<string, string>): Record<string, string> => ({
	[`${cwd}/package.json`]: JSON.stringify({ scripts }),
});

describe("dispatch — inject-env", () => {
	const baseEnv = { VITEST_AGENT_CONVERSATION_ID: "c1", VITEST_AGENT_AGENT_ID: "a1" };

	it("rewrites a direct vitest invocation with the env prefix", async () => {
		const result = await dispatch(["inject-env", "--command", "vitest run", "--cwd", cwd], ioFor(baseEnv));
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 vitest run\n");
	});

	it("returns the original command unchanged on a non-Vitest command", async () => {
		const io = ioFor(baseEnv, packageJson({ test: "vitest" }));
		const result = await dispatch(["inject-env", "--command", "ls -la", "--cwd", cwd], io);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("ls -la\n");
	});

	it("rewrites a package-script invocation using the package.json read through io", async () => {
		const io = ioFor(baseEnv, packageJson({ test: "vitest run" }));
		const result = await dispatch(["inject-env", "--command", "pnpm test", "--cwd", cwd], io);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 pnpm test\n");
	});

	it("falls back to io.cwd when --cwd is not passed", async () => {
		const io = ioFor(
			baseEnv,
			{ "/elsewhere/package.json": JSON.stringify({ scripts: { test: "vitest" } }) },
			"/elsewhere",
		);
		const result = await dispatch(["inject-env", "--command", "pnpm test"], io);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 pnpm test\n");
	});

	it("reads env from io, not the process", async () => {
		const result = await dispatch(["inject-env", "--command", "vitest run", "--cwd", cwd], ioFor({}));
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("vitest run\n");
	});

	it("parses --command and --cwd flags in either order", async () => {
		const result = await dispatch(["inject-env", "--cwd", cwd, "--command", "vitest"], ioFor(baseEnv));
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 vitest\n");
	});

	it("exits with code 5 and the stderr contract shape when --command is missing", async () => {
		const result = await dispatch(["inject-env", "--cwd", cwd], ioFor(baseEnv));
		expect(result.code).toBe(5);
		expect(result.stdout).toBe("");
		expect(result.stderr).toMatch(/^5 Defect: inject-env requires --command\n$/);
	});
});

describe("dispatch — unknown subcommand", () => {
	const io = ioFor({});

	it("exits non-zero with the `<code> <tag>: <message>` stderr shape", async () => {
		const result = await dispatch(["frobnicate"], io);
		expect(result.code).toBe(5);
		expect(result.stdout).toBe("");
		expect(result.stderr).toMatch(/^5 Defect: unknown subcommand: frobnicate\n$/);
	});

	it("reports `(none)` when no subcommand token is supplied", async () => {
		const result = await dispatch([], io);
		expect(result.code).toBe(5);
		expect(result.stderr).toMatch(/unknown subcommand: \(none\)/);
	});

	it("treats register-agent as unknown — it is not handled by the binary", async () => {
		const result = await dispatch(["register-agent", "--cwd", cwd], io);
		expect(result.code).toBe(5);
		expect(result.stdout).toBe("");
		expect(result.stderr).toMatch(/^5 Defect: unknown subcommand: register-agent\n$/);
	});
});
