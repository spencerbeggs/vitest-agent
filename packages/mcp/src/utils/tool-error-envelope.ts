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
 * Coerces an unknown thrown value into a display-safe message without
 * risking a second throw (a getter-backed `.message` can itself throw —
 * see `@vitest-agent/sdk`'s `coerceErrorField` for the same concern on
 * raw Vitest error objects).
 */
function coerceThrownMessage(err: unknown): string {
	if (err instanceof Error) {
		try {
			return err.message;
		} catch {
			return "<unreadable Error.message>";
		}
	}
	if (typeof err === "string") return err;
	try {
		return String(err);
	} catch {
		return "<unserializable thrown value>";
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
