import { createHash } from "node:crypto";
/** @public */
export interface FailureSignatureInput {
	readonly error_name: string;
	readonly assertion_message: string;
	readonly top_frame_function_name: string;
	readonly top_frame_function_boundary_line: number | null;
	readonly top_frame_raw_line?: number;
}

const ASSERTION_REGEX =
	/(toBe|toEqual|toContain|toMatch|toThrow|toBeNull|toBeUndefined|toBeTruthy|toBeFalsy|toBeGreaterThan|toBeLessThan|toBeInstanceOf|toBeCloseTo|toHaveBeenCalled|toHaveBeenCalledWith|toHaveProperty|toHaveLength)\s*\(([^)]*)\)/;

const typeTagOf = (literal: string): string => {
	const trimmed = literal.trim();
	if (trimmed === "" || trimmed === ")") return "";
	if (/^\d+(\.\d+)?$/.test(trimmed)) return "<number>";
	if (/^["'`]/.test(trimmed)) return "<string>";
	if (/^(true|false)$/.test(trimmed)) return "<boolean>";
	if (/^null$/.test(trimmed)) return "<null>";
	if (/^undefined$/.test(trimmed)) return "<undefined>";
	if (/^[{[]/.test(trimmed)) return "<object>";
	return "<expr>";
};
/** @public */
export const normalizeAssertionShape = (message: string): string | null => {
	const match = message.match(ASSERTION_REGEX);
	if (match === null) return null;
	const matcher = match[1];
	const arg = typeTagOf(match[2]);
	return arg === "" ? matcher : `${matcher}(${arg})`;
};
/** @public */
export const computeFailureSignature = (input: FailureSignatureInput): string => {
	const shape = normalizeAssertionShape(input.assertion_message) ?? "<unknown>";
	const lineCoord =
		input.top_frame_function_boundary_line !== null
			? `fb:${input.top_frame_function_boundary_line}`
			: input.top_frame_raw_line !== undefined
				? `raw:${Math.floor(input.top_frame_raw_line / 10) * 10}`
				: "raw:?";
	const key = `${input.error_name}|${shape}|${input.top_frame_function_name}|${lineCoord}`;
	return createHash("sha256").update(key).digest("hex").substring(0, 16);
};
