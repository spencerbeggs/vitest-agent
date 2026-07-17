import { Schema } from "effect";
import { FileEditPayload } from "./FileEditPayload.js";
import { HookFirePayload } from "./HookFirePayload.js";
import { HypothesisPayload } from "./HypothesisPayload.js";
import { NotePayload } from "./NotePayload.js";
import { ToolCallPayload } from "./ToolCallPayload.js";
import { ToolResultPayload } from "./ToolResultPayload.js";
import { UserPromptPayload } from "./UserPromptPayload.js";

export {
	FileEditPayload,
	HookFirePayload,
	HypothesisPayload,
	NotePayload,
	ToolCallPayload,
	ToolResultPayload,
	UserPromptPayload,
};
/** @public */
export const TurnPayload = Schema.Union([
	UserPromptPayload,
	ToolCallPayload,
	ToolResultPayload,
	FileEditPayload,
	HookFirePayload,
	NotePayload,
	HypothesisPayload,
]);

/** @public */
export type TurnPayload = typeof TurnPayload.Type;
