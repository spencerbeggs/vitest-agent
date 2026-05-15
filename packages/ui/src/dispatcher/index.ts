/**
 * Barrel for the shape-tailored dispatcher. Internal — not re-exported
 * from the package root. The preassembled default reporter built in
 * `factory/defaultReporter.ts` (phase 6) is the one public entry point
 * that uses these symbols.
 *
 * @packageDocumentation
 */

export type { AgentCellFn, Cell } from "./cell-types.js";
export { classifyOutcome, classifyRunShape } from "./classify.js";
export { dispatch, dispatchInk, dispatcherTable } from "./dispatch.js";
export { buildFooter, dominantClassification } from "./footer.js";
