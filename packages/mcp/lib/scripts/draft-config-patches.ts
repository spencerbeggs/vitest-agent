#!/usr/bin/env tsx
// packages/mcp/lib/scripts/draft-config-patches.ts
//
// One-shot helper for the update-vitest-snapshot skill. Walks every
// page under public/vendor/vitest-docs/config/, extracts the H1 option
// name plus the first bullet-list metadata block (Type/Default/CLI),
// and produces a `Use when configuring <option> ...` description ready
// to feed into apply-manifest-patches.ts. Output goes to stdout (so it
// can be piped to a file the agent reviews and edits before applying).
//
// Usage:
//   pnpm exec tsx packages/mcp/lib/scripts/draft-config-patches.ts > /tmp/config-patches.json

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SCRIPT_DIR, "..", "..");
const CONFIG_DIR = resolve(PKG_DIR, "public", "vendor", "vitest-docs", "config");

interface PageMeta {
	readonly title: string;
	readonly type: string | null;
	readonly defaultValue: string | null;
	readonly cli: string | null;
	readonly gist: string | null;
}

function walkConfig(dir: string, base = ""): ReadonlyArray<string> {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
		const next = base ? `${base}/${entry.name}` : entry.name;
		const abs = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walkConfig(abs, next));
		} else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "ATTRIBUTION.md") {
			out.push(next);
		}
	}
	return out;
}

function stripChrome(line: string): string {
	return line
		.replace(/<Version[^>]*>[^<]*<\/Version>/g, "")
		.replace(/<[^>]+\/?>/g, "")
		.replace(/\{#[^}]+\}/g, "")
		.replace(/\s+(\d+\.\d+(?:\.\d+)?)$/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function extractMeta(content: string): PageMeta {
	const lines = content.split(/\r?\n/);
	let title = "";
	let type: string | null = null;
	let defaultValue: string | null = null;
	let cli: string | null = null;
	let gist: string | null = null;
	let inCodeBlock = false;

	for (const line of lines) {
		if (line.startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			continue;
		}
		if (inCodeBlock) continue;
		if (!title && line.startsWith("# ")) {
			title = stripChrome(line.slice(2));
			continue;
		}
		const bullet = line.match(/^-\s+\*\*(Type|Default|CLI)[:：]?\*\*\s*(.+)$/);
		if (bullet?.[1] && bullet[2]) {
			const key = bullet[1];
			const value = stripChrome(bullet[2]);
			if (key === "Type" && !type) type = value;
			else if (key === "Default" && !defaultValue) defaultValue = value;
			else if (key === "CLI" && !cli) cli = value;
			continue;
		}
		// First non-meta prose paragraph after the bullet list becomes the gist.
		if (
			!gist &&
			line.length > 0 &&
			!line.startsWith("#") &&
			!line.startsWith("-") &&
			!line.startsWith(":::") &&
			!line.startsWith("<") &&
			!line.startsWith("function ") &&
			!line.startsWith("interface ") &&
			!line.startsWith("type ") &&
			!line.startsWith("class ")
		) {
			gist = stripChrome(line);
		}
	}

	return { title, type, defaultValue, cli, gist };
}

function buildDescription(slug: string, meta: PageMeta): string {
	const optionName = meta.title || slug;
	const head = `Use when configuring \`${optionName}\``;
	const facts: string[] = [];
	if (meta.type) facts.push(`Type ${meta.type}`);
	if (meta.defaultValue) facts.push(`default ${meta.defaultValue}`);
	if (meta.cli) {
		const firstFlag = meta.cli.split(",")[0]?.trim() ?? meta.cli;
		// firstFlag often already carries backticks; don't double-wrap.
		const flag = firstFlag.replace(/^`|`$/g, "");
		facts.push(`CLI \`${flag}\``);
	}
	let summary = facts.length > 0 ? ` — ${facts.join(", ")}` : "";
	let gist = meta.gist?.trim() ?? "";
	if (gist.length > 220) gist = `${gist.slice(0, 217)}...`;
	if (gist) summary += `. ${gist}`;
	return head + summary;
}

function buildTitle(slug: string, meta: PageMeta): string {
	if (meta.title) return meta.title;
	const last = slug.split("/").at(-1) ?? slug;
	return last.replace(/[-_]/g, " ");
}

function main(): void {
	const pages = walkConfig(CONFIG_DIR);
	const out: Record<string, { title: string; description: string }> = {};
	for (const relPath of pages) {
		const abs = join(CONFIG_DIR, relPath);
		if (!statSync(abs).isFile()) continue;
		const content = readFileSync(abs, "utf8");
		const meta = extractMeta(content);
		const slug = `config/${relPath.replace(/\.md$/, "")}`;
		out[slug] = {
			title: buildTitle(slug, meta),
			description: buildDescription(slug, meta),
		};
	}
	process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main();
