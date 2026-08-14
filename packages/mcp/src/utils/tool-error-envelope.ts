/**
 * Structured envelope for a resolver throw that escapes a tool's own
 * domain-specific error handling (issue #191, sub-item A).
 *
 * The MCP SDK's own `CallToolRequestSchema` handler already catches any
 * throw/rejection from a tool's resolver so a stray error inside a
 * single tool call cannot crash the process — but its fallback
 * (`createToolError`) is a bare, untyped `content[].text` string. Every
 * other tool in this package that can fail returns a structured
 * `{ ok: false, error: { _tag, ... } }` shape (see
 * `_tdd-error-envelope.ts`'s `TddErrorEnvelope` for the pattern this
 * mirrors). `server.ts`'s `safeRegisterTool` wrapper uses this builder
 * so an *unexpected* throw gets the same structured treatment instead
 * of degrading to a plain string the agent has to pattern-match.
 *
 * @packageDocumentation
 */

/**
 * Suggested recovery action attached to an {@link UnexpectedToolErrorEnvelope}.
 *
 * @public
 */
export interface UnexpectedToolErrorRemediation {
	readonly suggestedTool: string;
	readonly suggestedArgs: Record<string, unknown>;
	readonly humanHint: string;
}

/**
 * Success-shaped envelope returned when a tool's resolver throws or
 * rejects in a way none of its own domain-specific error handling
 * anticipated.
 *
 * @public
 */
export interface UnexpectedToolErrorEnvelope {
	readonly ok: false;
	readonly error: {
		readonly _tag: "UnexpectedToolError";
		readonly tool: string;
		readonly message: string;
		readonly remediation: UnexpectedToolErrorRemediation;
	};
}

/**
 * Fixed fallback used when even *introspecting* the thrown value throws.
 * Deliberately a constant — anything derived from `err` could throw again
 * on the recovery path.
 */
const UNREADABLE_THROWN_VALUE = "<unreadable thrown value>";

/**
 * Coerces an unknown thrown value into a display-safe message without
 * risking a second throw (a getter-backed `.message` can itself throw —
 * see `@vitest-agent/sdk`'s `coerceErrorField` for the same concern on
 * raw Vitest error objects).
 *
 * The outer guard matters as much as the inner one: `err instanceof
 * Error` walks the prototype chain, which a `Proxy` `getPrototypeOf`
 * trap can hijack and throw from, and `String(err)` invokes
 * `Symbol.toPrimitive` / `toString`, which a trap can hijack too. A
 * throw here escapes the envelope builder entirely and the agent gets
 * nothing structured back — the exact degradation this module exists to
 * prevent (issue #243).
 */
function coerceThrownMessage(err: unknown): string {
	try {
		if (typeof err === "string") return err;
		if (err instanceof Error) {
			try {
				const message: unknown = err.message;
				return typeof message === "string" ? message : String(message);
			} catch {
				return "<unreadable Error.message>";
			}
		}
		return String(err);
	} catch {
		return UNREADABLE_THROWN_VALUE;
	}
}

/**
 * Builds the structured envelope a tool's catch-all wrapper returns
 * when its resolver throws unexpectedly.
 *
 * @param toolName - the MCP tool name under which the resolver was registered
 * @param err - the value thrown or the rejection reason
 * @public
 */
export function buildUnexpectedToolErrorEnvelope(toolName: string, err: unknown): UnexpectedToolErrorEnvelope {
	const message = coerceThrownMessage(err);
	return {
		ok: false,
		error: {
			_tag: "UnexpectedToolError",
			tool: toolName,
			message,
			remediation: {
				suggestedTool: toolName,
				suggestedArgs: {},
				humanHint: `The "${toolName}" tool's resolver threw before producing a result (unrelated to your input in most cases). Retry the call; if it persists, check the MCP server's stderr for the logged error.`,
			},
		},
	};
}
