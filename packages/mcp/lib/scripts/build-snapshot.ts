#!/usr/bin/env tsx
// packages/mcp/lib/scripts/build-snapshot.ts
//
// Reads the raw upstream docs at packages/mcp/lib/vitest-docs-raw/ and
// produces a cleaned, schema-validated snapshot at
// packages/mcp/public/vendor/vitest-docs/. This is a *first cut*: the script
// applies a hardcoded denylist, strips VitePress frontmatter, derives a
// mechanical title from the H1 (or filename), and writes a placeholder
// description per page. The update-vitest-snapshot skill then has the
// agent rewrite each description with a strong "load when" signal —
// the user reviews the result before commit.
//
// Usage: pnpm exec tsx packages/mcp/lib/scripts/build-snapshot.ts
//
// Inputs:
//   packages/mcp/lib/vitest-docs-raw/.upstream-info.json (from fetch step)
//   packages/mcp/lib/vitest-docs-raw/**/*.md
//
// Outputs:
//   packages/mcp/public/vendor/vitest-docs/manifest.json (schema-validated)
//   packages/mcp/public/vendor/vitest-docs/ATTRIBUTION.md
//   packages/mcp/public/vendor/vitest-docs/<cleaned tree>

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import type { ManifestPage } from "../../src/resources/manifest-schema.js";
import { decodeUpstreamManifest, encodeUpstreamManifest } from "../../src/resources/manifest-schema.js";
import { seedAnnotations } from "./annotations-heuristic.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SCRIPT_DIR, "..", "..");
const RAW_DIR = resolve(PKG_DIR, "lib", "vitest-docs-raw");
const VENDOR_DIR = resolve(PKG_DIR, "public", "vendor", "vitest-docs");
const INFO_PATH = join(RAW_DIR, ".upstream-info.json");

// Files and directories the script always drops. These are VitePress site
// chrome, marketing pages, and internal repo pages that have no value as
// agent-facing documentation. The skill lets the agent extend this list
// when refreshing the snapshot.
//
// DENYLIST_FILES applies only at the root of the raw download.
// DENYLIST_PATHS applies anywhere in the tree (relative paths).
const DENYLIST_FILES = new Set(["index.md", "team.md", "todo.md", "blog.md"]);
const DENYLIST_DIRS = new Set(["blog", ".vitepress", "public"]);
const DENYLIST_PATHS = new Set([
	"guide/why.md",
	"guide/comparisons.md",
	"guide/browser/why.md",
	// Single-line code fragment with no agent value; full context lives in the
	// parent pages (Vitest, TestProject, TestModule).
	"api/advanced/import-example.md",
]);

function walkRaw(dir: string, base = ""): ReadonlyArray<string> {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const next = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (DENYLIST_DIRS.has(entry.name)) continue;
			out.push(...walkRaw(join(dir, entry.name), next));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			if (base === "" && DENYLIST_FILES.has(entry.name)) continue;
			if (DENYLIST_PATHS.has(next)) continue;
			out.push(next);
		}
	}
	return out;
}

function stripFrontmatter(source: string): string {
	if (!source.startsWith("---\n")) return source;
	const end = source.indexOf("\n---\n", 4);
	if (end === -1) return source;
	return source.slice(end + 5).replace(/^\n+/, "");
}

function deriveTitle(content: string, path: string): string {
	const h1 = content.match(/^#\s+(.+)$/m);
	if (h1?.[1]) return h1[1].trim();
	const segments = path.split("/");
	const last = segments.at(-1) ?? path;
	return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function placeholderDescription(path: string): string {
	const segments = path.split("/");
	const section = segments.length > 1 && segments[0] ? segments[0] : "reference";
	const topic = segments.length > 1 ? segments.slice(1).join(" / ") : (segments[0] ?? path);
	return `Vitest ${section} documentation: ${topic.replace(/[-_]/g, " ")}. [TODO: replace with load-when signal]`;
}

const program = Effect.gen(function* () {
	if (!existsSync(INFO_PATH)) {
		yield* Console.error(`error: ${INFO_PATH} not found. Run fetch-upstream-docs.ts first.`);
		return yield* Effect.fail(new Error("missing .upstream-info.json"));
	}

	const infoRaw = JSON.parse(readFileSync(INFO_PATH, "utf8")) as unknown;
	const info = yield* decodeUpstreamManifest(infoRaw);
	yield* Console.log(`Building snapshot from ${info.tag} (${info.commitSha.slice(0, 12)})`);

	const rawFiles = walkRaw(RAW_DIR);
	yield* Console.log(`Found ${rawFiles.length} markdown files after denylist filtering`);

	if (existsSync(VENDOR_DIR)) rmSync(VENDOR_DIR, { recursive: true, force: true });
	mkdirSync(VENDOR_DIR, { recursive: true });

	const pages: ManifestPage[] = [];
	for (const relPath of rawFiles) {
		const srcPath = join(RAW_DIR, relPath);
		const dstPath = join(VENDOR_DIR, relPath);
		const raw = readFileSync(srcPath, "utf8");
		const cleaned = `${stripFrontmatter(raw).trimEnd()}\n`;
		mkdirSync(dirname(dstPath), { recursive: true });
		writeFileSync(dstPath, cleaned);

		const pathKey = relPath.replace(/\.md$/, "");
		pages.push({
			path: pathKey,
			title: deriveTitle(cleaned, pathKey),
			description: placeholderDescription(pathKey),
			// Seed MCP resource annotations from the path-prefix heuristic
			// so the skill's review pass only adjusts the per-page exceptions
			// rather than authoring every value from scratch.
			annotations: seedAnnotations(pathKey),
		});
	}

	pages.sort((a, b) => a.path.localeCompare(b.path));

	const encodedManifest = yield* encodeUpstreamManifest({
		tag: info.tag,
		commitSha: info.commitSha,
		capturedAt: info.capturedAt,
		source: info.source,
		pages,
	});
	writeFileSync(join(VENDOR_DIR, "manifest.json"), `${JSON.stringify(encodedManifest, null, 2)}\n`);

	const attribution = [
		"# Attribution",
		"",
		`The markdown files under \`vendor/vitest-docs/\` are vendored from the [Vitest project](${info.source}) under the MIT License.`,
		"",
		"See `manifest.json` for the exact upstream tag and commit SHA captured.",
		"",
	].join("\n");
	writeFileSync(join(VENDOR_DIR, "ATTRIBUTION.md"), attribution);

	yield* Console.log("");
	yield* Console.log("Snapshot scaffolded:");
	yield* Console.log(`  pages:  ${pages.length}`);
	yield* Console.log(`  output: ${relative(PKG_DIR, VENDOR_DIR)}`);
	yield* Console.log("");
	yield* Console.log(
		"Next: open the skill flow — agent rewrites each manifest entry's `description` with a strong load-when signal.",
	);
});

NodeRuntime.runMain(program.pipe(Effect.tapErrorCause((cause) => Console.error(cause))));
