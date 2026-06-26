#!/usr/bin/env tsx
// packages/mcp/lib/scripts/apply-manifest-patches.ts
//
// Reads patches from a JSON file (object keyed by page path) and applies
// them to packages/mcp/public/vendor/vitest-docs/manifest.json. Patches may
// override `title` and/or `description` per entry. Pages not present in
// the patch are left untouched.
//
// Usage:
//   pnpm exec tsx packages/mcp/lib/scripts/apply-manifest-patches.ts <patches.json>
//
// Patch shape:
//   {
//     "api/mock": { "title": "Mocks", "description": "Use when ..." },
//     "api/test": { "description": "Use when ..." }
//   }

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { decodeUpstreamManifest, encodeUpstreamManifest } from "../../src/resources/manifest-schema.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SCRIPT_DIR, "..", "..");
const MANIFEST_PATH = join(PKG_DIR, "public", "vendor", "vitest-docs", "manifest.json");

interface Patch {
	readonly title?: string;
	readonly description?: string;
}

const program = Effect.gen(function* () {
	const patchPath = process.argv[2];
	if (!patchPath) {
		yield* Console.error("Usage: tsx apply-manifest-patches.ts <patches.json>");
		return yield* Effect.fail(new Error("missing patches file argument"));
	}
	const patchSource = readFileSync(patchPath, "utf8");
	if (!patchSource.trim()) {
		yield* Console.error(`error: ${patchPath} is empty`);
		return yield* Effect.fail(new Error("empty patches file"));
	}
	const patches = JSON.parse(patchSource) as Record<string, Patch>;

	const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
	const manifest = yield* decodeUpstreamManifest(raw);
	const pages = manifest.pages ?? [];

	let updated = 0;
	const unknownPaths: string[] = [];
	const patchedPaths = new Set(Object.keys(patches));

	const nextPages = pages.map((page) => {
		const patch = patches[page.path];
		if (!patch) return page;
		patchedPaths.delete(page.path);
		updated++;
		return {
			path: page.path,
			title: patch.title ?? page.title,
			description: patch.description ?? page.description,
		};
	});
	unknownPaths.push(...patchedPaths);

	const encoded = yield* encodeUpstreamManifest({
		tag: manifest.tag,
		commitSha: manifest.commitSha,
		capturedAt: manifest.capturedAt,
		source: manifest.source,
		pages: nextPages,
	});
	writeFileSync(MANIFEST_PATH, `${JSON.stringify(encoded, null, 2)}\n`);

	yield* Console.log(`Applied ${updated} patch(es).`);
	if (unknownPaths.length > 0) {
		yield* Console.error(`Warning: ${unknownPaths.length} patch(es) for unknown paths:`);
		for (const p of unknownPaths) yield* Console.error(`  - ${p}`);
		return yield* Effect.fail(new Error("unknown paths in patch"));
	}
});

NodeRuntime.runMain(program.pipe(Effect.tapErrorCause((cause) => Console.error(cause))));
