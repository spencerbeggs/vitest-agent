import { readFileSync } from "node:fs";
import type { StackFrameInput } from "@vitest-agent/sdk";
import { computeFailureSignature, findFunctionBoundary } from "@vitest-agent/sdk";

export interface VitestStackFrameLike {
	readonly file?: string;
	readonly line?: number;
	readonly column?: number;
	readonly method?: string;
}

export interface VitestErrorLike {
	readonly name?: string;
	readonly message: string;
	readonly stack?: string;
	readonly stacks?: ReadonlyArray<VitestStackFrameLike>;
}

// Per-line anchored regex (CodeQL flagged the prior global pattern for
// polynomial backtracking on stack-shaped inputs that never reach the trailing
// `:\d+:\d+`). We bound input by splitting on newlines first, and constrain
// the function-name and file-path captures to non-newline / non-paren chars.
const FRAME_LINE_REGEX = /^\s*at\s+(?:([\w$.<>[\] ]+?)\s+)?\(?([^\n)]+):(\d+):(\d+)\)?\s*$/;

const isFrameworkPath = (filePath: string): boolean =>
	filePath.includes("/node_modules/") ||
	filePath.includes("vitest/dist") ||
	filePath.includes("@vitest/") ||
	filePath.startsWith("node:");

interface RawFrame {
	readonly ordinal: number;
	readonly method: string | null;
	readonly filePath: string;
	readonly line: number;
	readonly col: number;
	readonly sourceMapped: boolean;
}

const parseFramesFromStackString = (stack: string): RawFrame[] => {
	const frames: RawFrame[] = [];
	let ordinal = 0;
	for (const line of stack.split("\n")) {
		const m = FRAME_LINE_REGEX.exec(line);
		if (m === null) continue;
		frames.push({
			ordinal: ordinal++,
			method: m[1] ?? null,
			filePath: m[2],
			line: Number.parseInt(m[3], 10),
			col: Number.parseInt(m[4], 10),
			sourceMapped: false,
		});
	}
	return frames;
};

const readSourceSafe = (filePath: string): string | null => {
	try {
		return readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
};

/**
 * Convert a Vitest error into structured frame inputs (with source-map and
 * function-boundary annotations) plus a stable failure signature.
 *
 * Returns `null` for the signature when no usable top frame is found
 * (error has no stack, or every frame is in framework code). Frames may
 * still be populated even when the signature is null.
 */
export const processFailure = (
	error: VitestErrorLike,
): { frames: ReadonlyArray<StackFrameInput>; signatureHash: string | null } => {
	// Prefer Vitest's parsed `stacks` (already source-mapped). Fall back to
	// regex over the raw `stack` string.
	const rawFrames: RawFrame[] =
		error.stacks !== undefined && error.stacks.length > 0
			? error.stacks.map((f, ordinal) => ({
					ordinal,
					method: f.method ?? null,
					filePath: f.file ?? "<unknown>",
					line: f.line ?? 0,
					col: f.column ?? 0,
					sourceMapped: true,
				}))
			: error.stack !== undefined
				? parseFramesFromStackString(error.stack)
				: [];

	// Find top non-framework frame. We resolve its function boundary first so
	// the boundary line can also flow back into the frame record.
	const topFrame = rawFrames.find((f) => f.filePath !== "<unknown>" && !isFrameworkPath(f.filePath));

	let topBoundaryLine: number | null = null;
	let topFunctionName: string | null = null;
	if (topFrame !== undefined) {
		// Vitest's parsed `stacks` and the regex-parsed fallback both produce
		// line numbers in the source's coordinate system at this point.
		const lineForBoundary = topFrame.line;
		const source = readSourceSafe(topFrame.filePath);
		const boundary = source !== null ? findFunctionBoundary(source, lineForBoundary) : null;
		if (boundary !== null) {
			topBoundaryLine = boundary.line;
			topFunctionName = boundary.name;
		}
	}

	const frames: StackFrameInput[] = rawFrames.map((f) => {
		const out: StackFrameInput = {
			ordinal: f.ordinal,
			method: f.method,
			filePath: f.filePath,
			line: f.line,
			col: f.col,
			...(f.sourceMapped && { sourceMappedLine: f.line }),
			...(topFrame !== undefined &&
				f.ordinal === topFrame.ordinal &&
				topBoundaryLine !== null && {
					functionBoundaryLine: topBoundaryLine,
				}),
		};
		return out;
	});

	if (topFrame === undefined) {
		return { frames, signatureHash: null };
	}

	const signatureHash = computeFailureSignature({
		error_name: error.name ?? "Error",
		assertion_message: error.message,
		top_frame_function_name: topFunctionName ?? topFrame.method ?? "<anonymous>",
		top_frame_function_boundary_line: topBoundaryLine,
		top_frame_raw_line: topFrame.line,
	});

	return { frames, signatureHash };
};
