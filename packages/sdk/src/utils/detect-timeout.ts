// "timed out in Nms" is the test/hook timeout wording. "hook timed out after
// Nms" is anchored to Vitest's around-hook wording so an ordinary user error
// such as "Request timed out after 500ms" is not counted as a timeout.
const TIMEOUT_MESSAGE = /\btimed out in \d+\s*ms|\bhook timed out after \d+\s*ms/i;
const TIMEOUT_NAME = /timeout/i;

/**
 * True when the error looks like a Vitest test or hook timeout. Either
 * the message matches "timed out in Nms" (test and hook timeouts) or
 * "hook timed out after Nms" (around-hook setup/teardown timeouts, present
 * since Vitest 5.0), or the error name contains "timeout"
 * (`TestTimeoutError`, `HookTimeoutError`; Vitest 5.1).
 * @public
 */
export const isTimeoutError = (error: { message?: string; name?: string }): boolean => {
	if (error.message !== undefined && TIMEOUT_MESSAGE.test(error.message)) return true;
	if (error.name !== undefined && TIMEOUT_NAME.test(error.name)) return true;
	return false;
};
