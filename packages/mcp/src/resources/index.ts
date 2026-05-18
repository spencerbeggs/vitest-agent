// packages/mcp/src/resources/index.ts

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Effect } from "effect";
import { renderPatternsIndex, renderUpstreamIndex } from "./indexes.js";
import type { ResourceAnnotations } from "./manifest-schema.js";
import { decodePatternsManifest, decodeUpstreamManifest } from "./manifest-schema.js";
import { readPattern } from "./patterns.js";
import { readUpstreamDoc } from "./upstream-docs.js";

/**
 * Convert the readonly ResourceAnnotations decoded from a manifest into
 * the mutable shape the MCP SDK's Annotations type expects. The shape is
 * structurally identical; only the readonly-ness differs.
 */
function toSdkAnnotations(a: ResourceAnnotations): {
	audience?: ("user" | "assistant")[];
	priority?: number;
} {
	const out: { audience?: ("user" | "assistant")[]; priority?: number } = {};
	if (a.audience !== undefined) out.audience = [...a.audience];
	if (a.priority !== undefined) out.priority = a.priority;
	return out;
}

function resolveContentRoots(): { vendorRoot: string; patternsRoot: string } {
	// import.meta.url maps to two layouts:
	//   source (tsx/vitest):  packages/mcp/src/resources/index.ts -> vendor at ../vendor/vitest-docs
	//   built (rslib bundle): dist/<env>/<chunk>.js              -> vendor at ./vendor/vitest-docs (via copyPatterns)
	const here = dirname(fileURLToPath(import.meta.url));
	const builtBase = here;
	const sourceBase = join(here, "..");
	const base = existsSync(join(builtBase, "vendor")) ? builtBase : sourceBase;
	return {
		vendorRoot: join(base, "vendor", "vitest-docs"),
		patternsRoot: join(base, "patterns"),
	};
}

interface ListedPage {
	readonly relativePath: string;
	readonly title?: string;
	readonly description?: string;
	readonly annotations?: ResourceAnnotations;
}

async function listManifestPages(vendorRoot: string): Promise<ReadonlyArray<ListedPage>> {
	const manifestPath = join(vendorRoot, "manifest.json");
	if (!existsSync(manifestPath)) return [];
	let raw: string;
	try {
		raw = await readFile(manifestPath, "utf8");
	} catch {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	const decoded = await Effect.runPromise(
		decodeUpstreamManifest(parsed).pipe(Effect.catchAll(() => Effect.succeed(null))),
	);
	if (!decoded?.pages) return [];
	return decoded.pages.map((page) => ({
		relativePath: page.path,
		title: page.title,
		description: page.description,
		...(page.annotations ? { annotations: page.annotations } : {}),
	}));
}

interface ListedPattern {
	readonly slug: string;
	readonly title: string;
	readonly summary: string;
	readonly annotations?: ResourceAnnotations;
}

async function listPatternEntries(patternsRoot: string): Promise<ReadonlyArray<ListedPattern>> {
	const metaPath = join(patternsRoot, "_meta.json");
	if (!existsSync(metaPath)) return [];
	let raw: string;
	try {
		raw = await readFile(metaPath, "utf8");
	} catch {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	const decoded = await Effect.runPromise(
		decodePatternsManifest(parsed).pipe(Effect.catchAll(() => Effect.succeed(null))),
	);
	if (!decoded) return [];
	return decoded.patterns.map((p) => ({
		slug: p.slug,
		title: p.title,
		summary: p.summary,
		...(p.annotations ? { annotations: p.annotations } : {}),
	}));
}

export function registerAllResources(server: McpServer): void {
	const { vendorRoot, patternsRoot } = resolveContentRoots();

	server.registerResource(
		"vitest_docs_index",
		"vitest://docs/",
		{
			title: "Vitest documentation: index",
			description:
				"Use first when you need any Vitest API, configuration, or behavioral information and aren't sure which page covers it — lists every page in the vendored snapshot grouped by section (api, config, guide) so you can pick the right `vitest://docs/<path>` URI before fetching.",
			mimeType: "text/markdown",
		},
		async (uri) => {
			const result = await renderUpstreamIndex(vendorRoot);
			return {
				contents: [{ uri: uri.href, mimeType: result.mimeType, text: result.content }],
			};
		},
	);

	server.registerResource(
		"vitest_docs_page",
		new ResourceTemplate("vitest://docs/{+path}", {
			list: async () => {
				const pages = await listManifestPages(vendorRoot);
				return {
					resources: pages.map((page) => ({
						name: `vitest_docs_${page.relativePath.replace(/\//g, "_")}`,
						uri: `vitest://docs/${page.relativePath}`,
						title: page.title ?? page.relativePath,
						description: page.description ?? `Vitest docs page: ${page.relativePath}`,
						mimeType: "text/markdown",
						...(page.annotations ? { annotations: toSdkAnnotations(page.annotations) } : {}),
					})),
				};
			},
		}),
		{
			title: "Vitest Documentation Page",
			description: "A single page from the vendored vitest.dev docs.",
			mimeType: "text/markdown",
		},
		async (uri, variables) => {
			const path = variables.path;
			const relative = Array.isArray(path) ? path.join("/") : String(path);
			const result = await readUpstreamDoc(vendorRoot, relative);
			return {
				contents: [{ uri: uri.href, mimeType: result.mimeType, text: result.content }],
			};
		},
	);

	server.registerResource(
		"vitest_agent_patterns_index",
		"vitest-agent://patterns/",
		{
			title: "vitest-agent patterns: index",
			description:
				"Use first when you need a curated vitest-agent pattern and want to discover what's available — lists every pattern slug with its title and one-line summary so you can pick the right `vitest-agent://patterns/<slug>` URI before fetching.",
			mimeType: "text/markdown",
		},
		async (uri) => {
			const result = await renderPatternsIndex(patternsRoot);
			return {
				contents: [{ uri: uri.href, mimeType: result.mimeType, text: result.content }],
			};
		},
	);

	server.registerResource(
		"vitest_agent_pattern",
		new ResourceTemplate("vitest-agent://patterns/{slug}", {
			list: async () => {
				const patterns = await listPatternEntries(patternsRoot);
				return {
					resources: patterns.map((p) => ({
						name: `vitest_agent_pattern_${p.slug.replace(/[^A-Za-z0-9]/g, "_")}`,
						uri: `vitest-agent://patterns/${p.slug}`,
						title: p.title,
						description: p.summary,
						mimeType: "text/markdown",
						...(p.annotations ? { annotations: toSdkAnnotations(p.annotations) } : {}),
					})),
				};
			},
		}),
		{
			title: "vitest-agent Pattern",
			description: "A single curated pattern from the vitest-agent project.",
			mimeType: "text/markdown",
		},
		async (uri, variables) => {
			const slug = variables.slug;
			const slugStr = Array.isArray(slug) ? slug[0] : String(slug);
			const result = await readPattern(patternsRoot, slugStr);
			return {
				contents: [{ uri: uri.href, mimeType: result.mimeType, text: result.content }],
			};
		},
	);
}
