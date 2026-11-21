// "timed out in Nms" is the test/hook timeout wording. "hook timed out after
// Nms" is anchored to Vitest's around-hook wording so an ordinary user error
// such as "Request timed out after 500ms" is not counted as a timeout.
const TIMEOUT_MESSAGE = /\btimed out in \d+\s*ms|\bhook timed out after \d+\s*ms/i;
// The closed set of Vitest 5.1 timeout error class names. A substring match
// would also catch AbortSignal.timeout's "TimeoutError", undici's
// "HeadersTimeoutError" and Effect's "TimeoutError", all user errors.
const VITEST_TIMEOUT_NAMES: ReadonlySet<string> = new Set(["TestTimeoutError", "HookTimeoutError"]);

/**
 * True when the error looks like a Vitest test or hook timeout. Either
 * the message matches "timed out in Nms" (test and hook timeouts) or
 * "hook timed out after Nms" (around-hook setup/teardown timeouts, present
 * since Vitest 5.0), or the error name is exactly `TestTimeoutError` or
 * `HookTimeoutError` (Vitest 5.1).
 * @public
 */
export const isTimeoutError = (error: { message?: string; name?: string }): boolean => {
	if (error.message !== undefined && TIMEOUT_MESSAGE.test(error.message)) return true;
	if (error.name !== undefined && VITEST_TIMEOUT_NAMES.has(error.name)) return true;
	return false;
};
