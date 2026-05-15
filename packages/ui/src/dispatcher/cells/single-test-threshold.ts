import type { Cell } from "../cell-types.js";

/**
 * No-op cell. The `single-test × threshold-violation` combination has
 * no observable difference from `single-test × all-pass` because a
 * single-test run never exercises the full file's coverage. The cell
 * exists so the dispatcher matrix is total; calling it falls through
 * to the empty string.
 */
export const renderSingleTestThreshold: Cell = {
	agent: () => "",
};
