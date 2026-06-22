import * as acorn from "acorn";
import { tsPlugin } from "acorn-typescript";

const Parser = acorn.Parser.extend(
	// biome-ignore lint/suspicious/noExplicitAny: acorn-typescript's plugin signature is loosely typed
	tsPlugin() as any,
);
/** @public */
export interface FunctionBoundary {
	readonly line: number;
	readonly name: string;
}

interface AstNode {
	type: string;
	loc?: { start: { line: number }; end: { line: number } };
	id?: { name: string } | null;
	body?: AstNode | AstNode[];
	declarations?: Array<{ id?: { name?: string }; init?: AstNode }>;
	[key: string]: unknown;
}

const isFunctionLike = (node: AstNode): boolean =>
	node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression";

const containsLine = (node: AstNode, line: number): boolean =>
	node.loc !== undefined && node.loc.start.line <= line && node.loc.end.line >= line;

const nodeName = (node: AstNode, parent: AstNode | null): string => {
	if (node.id !== null && node.id !== undefined) return node.id.name;
	// Anonymous function on a VariableDeclarator init: use the declarator's name
	if (parent !== null && parent.type === "VariableDeclarator") {
		const decl = parent as unknown as { id?: { name?: string } };
		if (decl.id !== undefined && decl.id.name !== undefined) return decl.id.name;
	}
	// Class method (MethodDefinition): use the key name (e.g. `greet` in `greet(name: string) {}`)
	if (parent !== null && parent.type === "MethodDefinition") {
		const method = parent as unknown as { key?: { name?: string } };
		if (method.key !== undefined && method.key.name !== undefined) return method.key.name;
	}
	return "<anonymous>";
};

/**
 * Parse `source` (JavaScript or TypeScript, via `acorn` + `acorn-typescript`)
 * and return the smallest enclosing function's start line and name for `line`.
 *
 * Returns `null` only when the parser rejects the source outright (rare —
 * usually a syntax error). Type annotations, generics, decorators, and `as`
 * casts are all accepted.
 * @public
 */
export const findFunctionBoundary = (source: string, line: number): FunctionBoundary | null => {
	let ast: AstNode;
	try {
		ast = Parser.parse(source, {
			ecmaVersion: "latest",
			sourceType: "module",
			locations: true,
		}) as unknown as AstNode;
	} catch {
		return null;
	}

	let smallest: { node: AstNode; parent: AstNode | null } | null = null;

	const walk = (node: AstNode | AstNode[] | null | undefined, parent: AstNode | null): void => {
		if (node === null || node === undefined) return;
		if (Array.isArray(node)) {
			for (const child of node) walk(child, parent);
			return;
		}
		if (typeof node !== "object") return;

		if (isFunctionLike(node) && containsLine(node, line)) {
			if (smallest === null) {
				smallest = { node, parent };
			} else {
				// biome-ignore lint/style/noNonNullAssertion: containsLine guarantees loc is defined
				const currSpan = smallest.node.loc!.end.line - smallest.node.loc!.start.line;
				// biome-ignore lint/style/noNonNullAssertion: containsLine guarantees loc is defined
				const newSpan = node.loc!.end.line - node.loc!.start.line;
				if (newSpan < currSpan) smallest = { node, parent };
			}
		}

		for (const key of Object.keys(node)) {
			if (key === "loc" || key === "type") continue;
			const value = (node as Record<string, unknown>)[key];
			if (value !== null && typeof value === "object") {
				walk(value as AstNode | AstNode[], node);
			}
		}
	};

	walk(ast, null);

	if (smallest === null) return null;
	const s = smallest as { node: AstNode; parent: AstNode | null };
	return {
		// biome-ignore lint/style/noNonNullAssertion: walker only stores nodes with loc
		line: s.node.loc!.start.line,
		name: nodeName(s.node, s.parent),
	};
};
