/**
 * `@vitest-agent/ui/ink`: the Ink half of vitest-agent's renderer.
 *
 * The React Ink components (`StreamApp`, the live `stream` frame, and the
 * leaf components it composes) and the Ink half of the shape-tailored
 * dispatcher matrix (`inkDispatcherTable`, `dispatchInk`). Everything here
 * loads React and Ink; everything pure — the reducer, `renderAgent`, the
 * agent dispatcher, the synthesizers, the theme tokens, the spinner
 * frames — lives at the package root, which never does. An agent or CI
 * run that imports only the root pays for neither.
 *
 * @packageDocumentation
 */

// The SDK types the Ink components' props and the Ink dispatcher's
// signatures name, so a consumer of this entry needs no direct
// `@vitest-agent/sdk` dependency to type them.
export type {
	CellOptions,
	CoverageRenderState,
	DispatchInputs,
	FailureRecord,
	FileCoverageReport,
	ModuleRecord,
	ProjectSummary,
	RenderState,
	RunOutcome,
	RunShape,
	SuggestedActionRecord,
	TestRecord,
	TrendSummary,
} from "@vitest-agent/sdk";

export { CountColumns, type CountColumnsProps, DURATION_CELL_WIDTH } from "./CountColumns.js";
export { CoverageBlock, type CoverageBlockProps } from "./CoverageBlock.js";
export { type InkCellFn, dispatchInk, inkDispatcherTable } from "./dispatch-ink.js";
export { FailureSection, type FailureSectionProps } from "./FailureSection.js";
export { FailuresSection, type FailuresSectionProps } from "./FailuresSection.js";
export { ModuleHeader, type ModuleHeaderProps } from "./ModuleHeader.js";
export { ProjectRow, type ProjectRowProps } from "./ProjectRow.js";
export { StatusIcon, type StatusIconKind, type StatusIconProps } from "./StatusIcon.js";
export { StreamApp, type StreamAppProps } from "./StreamApp.js";
export { SuggestedActions, type SuggestedActionsProps } from "./SuggestedActions.js";
export { TagColumns, type TagColumnsProps, tagUnion } from "./TagColumns.js";
export { TestRow, type TestRowProps } from "./TestRow.js";
export { TrendLine, type TrendLineProps } from "./TrendLine.js";
