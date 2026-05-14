#!/usr/bin/env tsx
// packages/mcp/lib/scripts/apply-annotations.ts
//
// One-shot: reads the existing manifest at
// packages/mcp/src/vendor/vitest-docs/manifest.json, applies the
// path-prefix annotation heuristic from annotations-heuristic.ts, and
// writes the file back in place. Idempotent — re-running on an
// already-annotated manifest produces the same output.
//
// Used to bootstrap T10 Phase B without re-running the full
// build-snapshot.ts pipeline (which would require the upstream raw
// docs to still be present at lib/vitest-docs-raw/).
//
// Usage: pnpm exec tsx packages/mcp/lib/scripts/apply-annotations.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { decodeUpstreamManifest, encodeUpstreamManifest } from "../../src/resources/manifest-schema.js";
import { seedAnnotations } from "./annotations-heuristic.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SCRIPT_DIR, "..", "..");
const MANIFEST_PATH = resolve(PKG_DIR, "src", "vendor", "vitest-docs", "manifest.json");

const program = Effect.gen(function* () {
	const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
	const manifest = yield* decodeUpstreamManifest(raw);
	const pages = manifest.pages ?? [];

	let updated = 0;
	let kept = 0;
	const annotated = pages.map((page) => {
		if (page.annotations) {
			kept++;
			return page;
		}
		updated++;
		return { ...page, annotations: seedAnnotations(page.path) };
	});

	const encoded = yield* encodeUpstreamManifest({
		tag: manifest.tag,
		commitSha: manifest.commitSha,
		capturedAt: manifest.capturedAt,
		source: manifest.source,
		pages: annotated,
	});

	writeFileSync(MANIFEST_PATH, `${JSON.stringify(encoded, null, 2)}\n`);

	yield* Console.log(`Annotated ${updated} new pages; kept ${kept} existing annotations.`);
	yield* Console.log(`Total pages: ${annotated.length}`);
});

NodeRuntime.runMain(program.pipe(Effect.tapErrorCause((cause) => Console.error(cause))));
