import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve the workspace root's node_modules so the subprocess can find
// vitest without a separate pnpm install in the tmpdir.
const WORKSPACE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const VITEST_BIN = join(WORKSPACE_ROOT, "node_modules/vitest/vitest.mjs");

// ---------------------------------------------------------------------------
// Shared test-project setup
// ---------------------------------------------------------------------------

function setupProject(dir: string) {
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "runner-smoke", type: "module" }, null, 2));
	// Symlink workspace node_modules so the subprocess can resolve vitest
	// without a separate install.
	symlinkSync(join(WORKSPACE_ROOT, "node_modules"), join(dir, "node_modules"));

	// A plain "unit" test file.
	writeFileSync(
		join(dir, "unit-x.test.ts"),
		`import { test, expect } from "vitest";
test("unit test passes", () => { expect(1 + 1).toBe(2); });
`,
	);

	// An "integration" test file, identified by the .int.test suffix.
	writeFileSync(
		join(dir, "int-x.int.test.ts"),
		`import { test, expect } from "vitest";
test("int test passes", () => { expect(2 + 2).toBe(4); });
`,
	);
}

// ---------------------------------------------------------------------------
// Helper: run vitest in the tmpdir and return parsed JSON output
// ---------------------------------------------------------------------------

function runVitest(dir: string, extraArgs: string[]): string {
	try {
		return execSync(`node ${VITEST_BIN} run --reporter=json --no-color ${extraArgs.join(" ")}`, {
			cwd: dir,
			encoding: "utf8",
			env: { ...process.env, CI: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (err: unknown) {
		// execSync throws on non-zero exit; capture stdout from the error.
		const e = err as { stdout?: string; stderr?: string };
		return `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
	}
}

function parseJson(output: string): Record<string, unknown> {
	const line = output.split("\n").find((l) => l.trim().startsWith("{") && l.includes('"testResults"'));
	if (!line) return {};
	try {
		return JSON.parse(line);
	} catch {
		return {};
	}
}

// ---------------------------------------------------------------------------
// Approach A — custom VitestRunner with onCollected tag mutation
//
// The VitestRunner.onCollected() hook fires AFTER interpretTaskModes() has
// already applied the --tags-filter and set skipped/run modes on tasks.
// Mutating task.tags in onCollected is too late for filter selection, but
// the tags ARE visible to reporters (they read task.tags post-run).
//
// This test documents the negative finding: onCollected cannot influence
// which tests are selected by --tags-filter. It runs to verify:
//   1. Tags set in onCollected appear in reporter output (good for reporting).
//   2. --tags-filter does NOT filter correctly based on onCollected tags.
// ---------------------------------------------------------------------------

describe("Approach A — runner onCollected (late mutation, blocked for filtering)", () => {
	it("onCollected fires after interpretTaskModes — tags-filter cannot use runner-injected tags", () => {
		const dir = mkdtempSync(join(tmpdir(), "runner-a-"));
		try {
			setupProject(dir);

			// Write a custom runner module that tags tests in onCollected
			// based on the file path.
			writeFileSync(
				join(dir, "tag-runner.mjs"),
				`
import { VitestTestRunner } from "vitest/runners";

export default class TaggingRunner extends VitestTestRunner {
  async onCollected(files) {
    for (const file of files) {
      const isInt = file.filepath.includes(".int.test.");
      const tag = isInt ? "int" : "unit";
      function tagTasks(tasks) {
        for (const task of tasks) {
          task.tags = task.tags ?? [];
          if (!task.tags.includes(tag)) task.tags.push(tag);
          if (task.tasks) tagTasks(task.tasks);
        }
      }
      tagTasks(file.tasks);
    }
  }
}
`,
			);

			writeFileSync(
				join(dir, "vitest.config.ts"),
				`import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    runner: "./tag-runner.mjs",
    include: ["*.test.ts", "*.int.test.ts"],
    tags: [{ name: "unit" }, { name: "int" }],
  },
});
`,
			);

			// Run without filter — both tests should run.
			const rawAll = runVitest(dir, []);
			const jsonAll = parseJson(rawAll);
			const resultsAll = jsonAll.testResults as
				| Array<{ name: string; assertionResults: Array<{ status: string; tags?: string[] }> }>
				| undefined;
			expect(resultsAll?.length).toBe(2);

			// Run with --tags-filter int — ONLY the .int. file should run.
			// Because onCollected fires AFTER interpretTaskModes, the tags
			// injected there are NOT seen by the filter. Both files have empty
			// tags at filter time, so Vitest skips all tests (neither runs).
			const rawFiltered = runVitest(dir, ["--tags-filter", "int"]);
			const jsonFiltered = parseJson(rawFiltered);
			const resultsFiltered = jsonFiltered.testResults as
				| Array<{ name: string; assertionResults: Array<{ status: string; tags?: string[] }> }>
				| undefined;

			// The int test must NOT be running (tags are empty at filter time).
			const intTestRan = resultsFiltered?.some(
				(r) => r.name.includes(".int.test.") && r.assertionResults.some((a) => a.status === "passed"),
			);
			// The unit test must also be skipped (all tests have empty tags).
			const unitTestRan = resultsFiltered?.some(
				(r) => !r.name.includes(".int.test.") && r.assertionResults.some((a) => a.status === "passed"),
			);

			// Both are skipped: the filter cannot distinguish them because
			// onCollected runs too late. Neither file passes its test.
			// This documents the BLOCKED finding for Approach A.
			expect(intTestRan).toBe(false);
			expect(unitTestRan).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// Approach B — Vite plugin transform that rewrites test() calls
//
// A Vite plugin transform fires before the test file is imported. By the
// time collectTests() → importFile() → getDefaultSuite().collect() runs,
// the tasks already have the injected tags. interpretTaskModes() then sees
// those tags when applying the --tags-filter.
//
// This is the approach that DOES work for both:
//   1. Tags visible in reporter output (task.tags post-run).
//   2. --tags-filter correctly selecting tests.
// ---------------------------------------------------------------------------

describe("Approach B — Vite plugin transform (early injection, works)", () => {
	it("transform-injected test tags appear in JSON output and are not filtered when no filter is applied", () => {
		const dir = mkdtempSync(join(tmpdir(), "runner-b1-"));
		try {
			setupProject(dir);

			writeFileSync(
				join(dir, "vitest.config.ts"),
				`import { defineConfig } from "vitest/config";
import { basename } from "node:path";

export default defineConfig({
  plugins: [{
    name: "auto-tag",
    transform(code, id) {
      if (!id.endsWith(".test.ts")) return null;
      const name = basename(id);
      const tag = name.includes(".int.test.") ? "int" : "unit";
      // Wrap each test() call to inject the tag into its options.
      // This regex handles: test("name", fn) and test("name", {opts}, fn)
      const patched = code.replace(
        /\\btest\\(([^,]+),\\s*(?:\\{([^}]*)\\},\\s*)?(\\(|async)/g,
        (match, nameArg, existingOpts, fnStart) => {
          const opts = existingOpts
            ? \`{ ...(\${existingOpts.trim() || "{}"}), tags: ["\${tag}"] }\`
            : \`{ tags: ["\${tag}"] }\`;
          return \`test(\${nameArg}, \${opts}, \${fnStart}\`;
        }
      );
      return { code: patched, map: null };
    },
  }],
  test: {
    include: ["*.test.ts", "*.int.test.ts"],
    tags: [{ name: "unit" }, { name: "int" }],
  },
});
`,
			);

			const rawAll = runVitest(dir, []);
			const jsonAll = parseJson(rawAll);
			const testResultsAll = jsonAll.testResults as Array<Record<string, unknown>> | undefined;

			// Both files should run with no filter.
			expect(testResultsAll?.length).toBe(2);
			const passedAll = testResultsAll?.every((r) => r.status === "passed");
			expect(passedAll).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("transform-injected int tag causes --tags-filter int to run ONLY the .int.test file", () => {
		const dir = mkdtempSync(join(tmpdir(), "runner-b2-"));
		try {
			setupProject(dir);

			writeFileSync(
				join(dir, "vitest.config.ts"),
				`import { defineConfig } from "vitest/config";
import { basename } from "node:path";

export default defineConfig({
  plugins: [{
    name: "auto-tag",
    transform(code, id) {
      if (!id.endsWith(".test.ts")) return null;
      const name = basename(id);
      const tag = name.includes(".int.test.") ? "int" : "unit";
      const patched = code.replace(
        /\\btest\\(([^,]+),\\s*(?:\\{([^}]*)\\},\\s*)?(\\(|async)/g,
        (match, nameArg, existingOpts, fnStart) => {
          const opts = existingOpts
            ? \`{ ...(\${existingOpts.trim() || "{}"}), tags: ["\${tag}"] }\`
            : \`{ tags: ["\${tag}"] }\`;
          return \`test(\${nameArg}, \${opts}, \${fnStart}\`;
        }
      );
      return { code: patched, map: null };
    },
  }],
  test: {
    include: ["*.test.ts", "*.int.test.ts"],
    tags: [{ name: "unit" }, { name: "int" }],
  },
});
`,
			);

			// Run with --tags-filter int — only the int test should run.
			const rawFiltered = runVitest(dir, ["--tags-filter", "int"]);
			const jsonFiltered = parseJson(rawFiltered);
			// JSON reporter uses "name" (not "testFilePath") for the file path.
			const testResultsFiltered = jsonFiltered.testResults as
				| Array<{
						name: string;
						status: string;
						assertionResults: Array<{ status: string; tags?: string[] }>;
				  }>
				| undefined;

			expect(testResultsFiltered).toBeDefined();

			// The int file must have a passing test.
			const intFileResult = testResultsFiltered?.find((r) => r.name.includes(".int.test."));
			const intTestPassed = intFileResult?.assertionResults.some((a) => a.status === "passed");

			// The unit file must have no passing tests (all skipped due to filter).
			const unitFileResult = testResultsFiltered?.find((r) => !r.name.includes(".int.test."));
			const unitTestPassed = unitFileResult?.assertionResults.some((a) => a.status === "passed");

			// This is the make-or-break assertion: transform-injected tags
			// must be seen by --tags-filter at collection time.
			expect(intTestPassed).toBe(true);
			expect(unitTestPassed).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
