import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../src/lib/sidecar-dispatch.js";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "sidecar-dispatch-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

const writePackageJson = (scripts: Record<string, string>) => {
	writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts }), "utf-8");
};

describe("dispatch — inject-env", () => {
	const baseEnv = { VITEST_AGENT_CONVERSATION_ID: "c1", VITEST_AGENT_AGENT_ID: "a1" };

	it("rewrites a direct vitest invocation with the env prefix", async () => {
		Object.assign(process.env, baseEnv);
		const result = await dispatch(["inject-env", "--command", "vitest run", "--cwd", cwd]);
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 vitest run\n");
	});

	it("returns the original command unchanged on a non-Vitest command", async () => {
		Object.assign(process.env, baseEnv);
		writePackageJson({ test: "vitest" });
		const result = await dispatch(["inject-env", "--command", "ls -la", "--cwd", cwd]);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("ls -la\n");
	});

	it("parses --command and --cwd flags in either order", async () => {
		Object.assign(process.env, baseEnv);
		const result = await dispatch(["inject-env", "--cwd", cwd, "--command", "vitest"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 vitest\n");
	});

	it("exits with code 5 and the stderr contract shape when --command is missing", async () => {
		const result = await dispatch(["inject-env", "--cwd", cwd]);
		expect(result.code).toBe(5);
		expect(result.stdout).toBe("");
		expect(result.stderr).toMatch(/^5 Defect: inject-env requires --command\n$/);
	});
});

describe("dispatch — unknown subcommand", () => {
	it("exits non-zero with the `<code> <tag>: <message>` stderr shape", async () => {
		const result = await dispatch(["frobnicate"]);
		expect(result.code).toBe(5);
		expect(result.stdout).toBe("");
		expect(result.stderr).toMatch(/^5 Defect: unknown subcommand: frobnicate\n$/);
	});

	it("reports `(none)` when no subcommand token is supplied", async () => {
		const result = await dispatch([]);
		expect(result.code).toBe(5);
		expect(result.stderr).toMatch(/unknown subcommand: \(none\)/);
	});

	it("treats register-agent as unknown — it is not handled by the binary", async () => {
		const result = await dispatch(["register-agent", "--cwd", cwd]);
		expect(result.code).toBe(5);
		expect(result.stdout).toBe("");
		expect(result.stderr).toMatch(/^5 Defect: unknown subcommand: register-agent\n$/);
	});
});
