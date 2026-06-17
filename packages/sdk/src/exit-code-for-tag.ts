/**
 * Tagged-error → sidecar exit-code mapping.
 *
 * `exitCodeForTag` maps a tagged-error `_tag` to the agent-agnostic
 * sidecar exit-code taxonomy (0 success, 1 conflict, 2 timeout, 3 db
 * error, 4 identity unresolvable, 5 other). It is shared byte-identically
 * between the `@vitest-agent/sidecar` native binary (via the
 * `@vitest-agent/sdk/dispatch` entry) and the `@vitest-agent/cli`
 * `agent` subcommands so the two surfaces never fork their exit codes.
 *
 * @packageDocumentation
 */

/**
 * Map a tagged-error `_tag` to the agent-agnostic sidecar exit-code
 * taxonomy. Unknown tags collapse to `5` (other unexpected defect).
 */
export const exitCodeForTag = (tag: string): number => {
	switch (tag) {
		case "RegistrationConflictError":
			return 1;
		case "SidecarTimeoutError":
			return 2;
		case "DataStoreError":
			return 3;
		case "ProjectIdentityNotResolvableError":
			return 4;
		default:
			return 5;
	}
};
