/**
 * Map a tagged-error `_tag` to the agent-agnostic sidecar exit-code
 * taxonomy. Unknown tags collapse to `5` (other unexpected defect).
 * @public
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
