import * as acorn from "acorn";
import { tsPlugin } from "acorn-typescript";
import type { SourceMap } from "magic-string";
import MagicString from "magic-string";

// biome-ignore lint/suspicious/noExplicitAny: acorn-typescript's plugin signature is loosely typed
const Parser = acorn.Parser.extend(tsPlugin() as any);

const TEST_NAMES = new Set(["test", "it"]);

interface Node {
	type: string;
	start: number;
	end: number;
	[key: string]: unknown;
}

function rootIdentifier(n: Node): Node | null {
	if (n.type === "Identifier") return n;
	if (n.type === "MemberExpression") return rootIdentifier(n.object as Node);
	if (n.type === "CallExpression") return rootIdentifier(n.callee as Node);
	return null;
}

function isTestCallee(callee: Node): boolean {
	const root = rootIdentifier(callee);
	return !!root && TEST_NAMES.has(root.name as string);
}

function hasTagsField(objectExpression: Node): boolean {
	const props = (objectExpression.properties as Node[]) ?? [];
	for (const p of props) {
		if (p.type !== "Property") continue;
		const key = p.key as Node;
		if (key.type === "Identifier" && (key.name as string) === "tags") return true;
		if (key.type === "Literal" && (key.value as unknown) === "tags") return true;
	}
	return false;
}

function tagsLiteral(tags: ReadonlyArray<string>): string {
	return `[${tags.map((t) => JSON.stringify(t)).join(", ")}]`;
}

function walk(node: Node, visit: (n: Node) => void): void {
	visit(node);
	for (const key of Object.keys(node)) {
		if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
		const v = node[key];
		if (Array.isArray(v)) {
			for (const item of v) {
				if (item && typeof item === "object" && "type" in item) walk(item as Node, visit);
			}
		} else if (v && typeof v === "object" && "type" in v) {
			walk(v as Node, visit);
		}
	}
}

/**
 * Return value of the Vite `transform` hook — the rewritten source code and its source map.
 * @public
 */
export interface InjectTagsResult {
	/** The transformed source code string with injected `tags` arguments. */
	code: string;
	/** Source map correlating transformed positions back to the original source. */
	map: SourceMap;
}

export function injectTags(source: string, tags: ReadonlyArray<string>): InjectTagsResult | null {
	if (tags.length === 0) return null;

	let ast: Node;
	try {
		ast = Parser.parse(source, {
			ecmaVersion: "latest",
			sourceType: "module",
			locations: true,
		}) as unknown as Node;
	} catch {
		return null;
	}

	const ms = new MagicString(source);
	let mutated = false;

	walk(ast, (node) => {
		if (node.type !== "CallExpression") return;
		const callee = node.callee as Node;
		if (!isTestCallee(callee)) return;

		const args = (node.arguments as Node[]) ?? [];
		if (args.length < 2) return;
		const last = args[args.length - 1];
		const lastIsFunction = last.type === "FunctionExpression" || last.type === "ArrowFunctionExpression";
		if (!lastIsFunction) return;

		const optsCandidate = args.length >= 3 ? args[args.length - 2] : null;
		if (optsCandidate) {
			if (optsCandidate.type === "ObjectExpression") {
				if (hasTagsField(optsCandidate)) return;
				const props = (optsCandidate.properties as Node[]) ?? [];
				const lastProp = props.at(-1);
				if (lastProp === undefined) {
					// Empty object: insert directly before closing brace
					const insertPoint = (optsCandidate.end as number) - 1;
					ms.appendLeft(insertPoint, `tags: ${tagsLiteral(tags)} `);
				} else {
					// Non-empty: insert after the last property
					ms.appendLeft(lastProp.end as number, `, tags: ${tagsLiteral(tags)}`);
				}
				mutated = true;
				return;
			}
			// Non-literal options expression (Identifier, CallExpression, etc.):
			// wrap with spread to preserve runtime semantics and add tags.
			// The spread of null/undefined is a no-op; spread of an object copies
			// its keys. The tags property is appended after the spread so it
			// cannot be overridden by the original expression.
			const optsStart = optsCandidate.start as number;
			const optsEnd = optsCandidate.end as number;
			const origExpr = source.slice(optsStart, optsEnd);
			ms.overwrite(optsStart, optsEnd, `{ ...(${origExpr}), tags: ${tagsLiteral(tags)} }`);
			mutated = true;
			return;
		}

		const nameArg = args[0];
		ms.appendRight(nameArg.end as number, `, { tags: ${tagsLiteral(tags)} }`);
		mutated = true;
	});

	if (!mutated) return null;
	return { code: ms.toString(), map: ms.generateMap({ hires: true }) };
}
