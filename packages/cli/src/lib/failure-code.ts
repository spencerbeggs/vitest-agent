import { exitCodeForTag } from "@vitest-agent/sdk/dispatch";

/**
 * The exit code for a squashed failure: the sidecar family's code for its
 * `_tag`, or the defect code when it has no string tag. The `codeOf` that
 * `orReportCause` hands to `CliExit.reportCause`.
 *
 * @internal
 */
export const failureCode = (error: unknown): number => {
	try {
		const tag = (error as { readonly _tag?: unknown } | null | undefined)?._tag;
		return exitCodeForTag(typeof tag === "string" ? tag : "Defect");
	} catch {
		// A throwing getter must not turn a reported failure into a defect.
		return exitCodeForTag("Defect");
	}
};
