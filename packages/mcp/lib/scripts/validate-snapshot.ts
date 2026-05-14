#!/usr/bin/env tsx
// packages/mcp/lib/scripts/validate-snapshot.ts
//
// Quality gate for the cleaned snapshot at
// packages/mcp/src/vendor/vitest-docs/. Run after build-snapshot.ts and
// after the agent has rewritten descriptions during the
// update-vitest-snapshot skill.
//
// Checks:
//   1. manifest.json decodes against UpstreamManifest schema
//   2. manifest carries a non-empty pages[] array
//   3. every .md file under src/vendor/vitest-docs/ has a manifest entry
//   4. every manifest entry resolves to an existing .md file
//   5. no description still carries the "[TODO" placeholder marker
//
// Usage: pnpm exec tsx packages/mcp/lib/scripts/validate-snapshot.ts

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { decodeUpstreamManifest } from "../../src/resources/manifest-schema.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SCRIPT_DIR, "..", "..");
const VENDOR_DIR = resolve(PKG_DIR, "src", "vendor", "vitest-docs");
const MANIFEST_PATH = join(VENDOR_DIR, "manifest.json");
const PLACEHOLDER_MARKER = "[TODO";
const MIN_DESCRIPTION_LENGTH = 30;

function walkPages(dir: string, base = ""): ReadonlyArray<string> {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const next = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			out.push(...walkPages(join(dir, entry.name), next));
		} else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "ATTRIBUTION.md") {
			out.push(next.replace(/\.md$/, ""));
		}
	}
	return out;
}

const program = Effect.gen(function* () {
	if (!existsSync(MANIFEST_PATH)) {
		yield* Console.error(`error: ${MANIFEST_PATH} not found`);
		return yield* Effect.fail(new Error("missing manifest.json"));
	}

	const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
	const manifest = yield* decodeUpstreamManifest(raw);
	const pages = manifest.pages ?? [];

	const errors: string[] = [];

	if (pages.length === 0) {
		errors.push("manifest.json carries no `pages` entries — run build-snapshot.ts");
	}

	const manifestPaths = new Set(pages.map((p) => p.path));
	const filePaths = new Set(walkPages(VENDOR_DIR));

	for (const filePath of filePaths) {
		if (!manifestPaths.has(filePath)) {
			errors.push(`file present but not in manifest: ${filePath}`);
		}
	}
	let annotatedCount = 0;
	for (const page of pages) {
		if (!filePaths.has(page.path)) {
			errors.push(`manifest entry without file: ${page.path}`);
		}
		if (page.description.includes(PLACEHOLDER_MARKER)) {
			errors.push(`description still has TODO marker: ${page.path}`);
		}
		if (page.description.length < MIN_DESCRIPTION_LENGTH) {
			errors.push(`description too short (${page.description.length} < ${MIN_DESCRIPTION_LENGTH} chars): ${page.path}`);
		}
		if (page.annotations) {
			annotatedCount++;
			if (page.annotations.audience !== undefined && page.annotations.audience.length === 0) {
				errors.push(`annotations.audience is empty array (set entries or omit field): ${page.path}`);
			}
			// Schema enforces priority in [0, 1] at decode time; the
			// friendlier error message is included for the rare case where a
			// future schema relaxation lets out-of-range values through.
			if (page.annotations.priority !== undefined) {
				const p = page.annotations.priority;
				if (p < 0 || p > 1) {
					errors.push(`annotations.priority out of range [0, 1]: ${page.path} = ${p}`);
				}
			}
		}
	}

	if (pages.length > 0 && annotatedCount > 0 && annotatedCount < pages.length) {
		yield* Console.warn(
			`warning: ${annotatedCount}/${pages.length} pages carry annotations — finish the editorial pass for the remaining ${pages.length - annotatedCount}.`,
		);
	}

	if (errors.length > 0) {
		yield* Console.error(`Validation failed (${errors.length} error(s)):`);
		for (const err of errors) {
			yield* Console.error(`  - ${err}`);
		}
		return yield* Effect.fail(new Error(`validation failed: ${errors.length} error(s)`));
	}

	yield* Console.log(`Validation passed: ${pages.length} pages, all entries match.`);
	yield* Console.log(`  tag: ${manifest.tag} (${manifest.commitSha.slice(0, 12)})`);
});

NodeRuntime.runMain(program.pipe(Effect.tapErrorCause((cause) => Console.error(cause))));
