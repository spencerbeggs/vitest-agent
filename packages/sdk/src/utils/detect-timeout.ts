/**
 * Pure matcher: does a test error represent a timeout?
 *
 * Vitest has no distinct timed-out test state. A test that exceeds its
 * limit is reported as failed with a timeout-flavored error. Stream
 * mode splits these out as a separate outcome, so the reporter runs this
 * matcher over each failed test's first error.
 *
 * @packageDocumentation
 */

const TIMEOUT_MESSAGE = /\btimed out in \d+\s*ms/i;
const TIMEOUT_NAME = /timeout/i;

/**
 * True when the error looks like a Vitest test or hook timeout. Either
 * the message matches "timed out in Nms" or the error name contains
 * "timeout".
 */
export const isTimeoutError = (error: { message?: string; name?: string }): boolean => {
	if (error.message !== undefined && TIMEOUT_MESSAGE.test(error.message)) return true;
	if (error.name !== undefined && TIMEOUT_NAME.test(error.name)) return true;
	return false;
};
