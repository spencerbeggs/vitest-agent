/**
 * Ink component tree for the human-mode renderers.
 *
 * `StreamApp` is the agent-shaped, lifecycle-aware root for the `stream`
 * console mode; the remaining files are the leaf components it and the
 * dispatcher cells compose.
 *
 * @packageDocumentation
 */

export { CountColumns, type CountColumnsProps } from "./CountColumns.js";
export { CoverageBlock, type CoverageBlockProps } from "./CoverageBlock.js";
export { FailureSection, type FailureSectionProps } from "./FailureSection.js";
export { FailuresSection, type FailuresSectionProps } from "./FailuresSection.js";
export { ModuleHeader, type ModuleHeaderProps } from "./ModuleHeader.js";
export { ProjectRow, type ProjectRowProps } from "./ProjectRow.js";
export { StatusIcon, type StatusIconKind, type StatusIconProps } from "./StatusIcon.js";
export { StreamApp, type StreamAppProps } from "./StreamApp.js";
export { SuggestedActions, type SuggestedActionsProps } from "./SuggestedActions.js";
export { SPINNER_FRAMES, SPINNER_FRAME_MS, spinnerFrame, spinnerFrameForTime } from "./spinner.js";
export { TestRow, type TestRowProps } from "./TestRow.js";
export { TrendLine, type TrendLineProps } from "./TrendLine.js";
