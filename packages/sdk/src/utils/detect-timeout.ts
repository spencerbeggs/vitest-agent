const TIMEOUT_MESSAGE = /\btimed out (?:in|after) \d+\s*ms/i;
const TIMEOUT_NAME = /timeout/i;

/**
 * True when the error looks like a Vitest test or hook timeout. Either
 * the message matches "timed out in Nms" (test and hook timeouts) or
 * "timed out after Nms" (around-hook setup/teardown timeouts, Vitest 5.1),
 * or the error name contains "timeout" (`TestTimeoutError`,
 * `HookTimeoutError`).
 * @public
 */
export const isTimeoutError = (error: { message?: string; name?: string }): boolean => {
	if (error.message !== undefined && TIMEOUT_MESSAGE.test(error.message)) return true;
	if (error.name !== undefined && TIMEOUT_NAME.test(error.name)) return true;
	return false;
};
