// Consolidated `note` MCP tool — Schema-driven implementation.
//
// Every action now returns a structured object; the boundary in
// server.ts renders markdown for `list` / `search` callers via the
// exported `formatNoteListMarkdown` helper. The mutation actions
// (`create`, `update`, `delete`, `get`) carry their previous shapes.

import type { NoteInput } from "@vitest-agent/engine";
import { DataReader, DataStore } from "@vitest-agent/engine";
import { Effect, Match, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

const NoteScope = Schema.Literals(["global", "project", "module", "suite", "test", "note"]);

const NoteRowSchema = Schema.Struct({
	id: Schema.Finite.annotate({ description: "Note primary key." }),
	title: Schema.String,
	content: Schema.String,
	scope: NoteScope.annotate({
		description:
			"`global` (project-agnostic), `project`, `module`, `suite`, `test` (scoped), or `note` (child note attached via `parentNoteId`).",
	}),
	project: Schema.NullOr(Schema.String),
	testFullName: Schema.NullOr(Schema.String),
	modulePath: Schema.NullOr(Schema.String),
	parentNoteId: Schema.NullOr(Schema.Number),
	createdBy: Schema.NullOr(Schema.String),
	expiresAt: Schema.NullOr(Schema.String),
	pinned: Schema.Boolean,
	createdAt: Schema.String,
	updatedAt: Schema.String,
}).annotate({ identifier: "NoteRow" });

const NoteCreateOk = Schema.Struct({
	action: Schema.Literal("create"),
	id: Schema.Finite.annotate({ description: "Primary key of the newly inserted note." }),
});

const NoteListOk = Schema.Struct({
	action: Schema.Literal("list"),
	count: Schema.Number,
	notes: Schema.Array(NoteRowSchema).annotate({
		description: "Notes matching the optional scope/project/test filters.",
	}),
});

const NoteGetFound = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(true),
	note: NoteRowSchema,
});

const NoteGetMissing = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(false),
	id: Schema.Number,
});

const NoteUpdateOk = Schema.Struct({
	action: Schema.Literal("update"),
	success: Schema.Literal(true),
});

const NoteDeleteOk = Schema.Struct({
	action: Schema.Literal("delete"),
	success: Schema.Literal(true),
});

const NoteSearchOk = Schema.Struct({
	action: Schema.Literal("search"),
	query: Schema.String,
	count: Schema.Number,
	notes: Schema.Array(NoteRowSchema).annotate({ description: "Notes whose title or content match the FTS5 query." }),
});

/**
 * The `note` tool's success payload.
 *
 * @public
 */
export const NoteResult = Schema.Union([
	NoteCreateOk,
	NoteListOk,
	NoteGetFound,
	NoteGetMissing,
	NoteUpdateOk,
	NoteDeleteOk,
	NoteSearchOk,
]).annotate({
	identifier: "NoteResult",
	title: "note result",
	description: "Discriminate on `action`. `get` further discriminates on `found`.",
});
/**
 * The decoded {@link NoteResult}.
 *
 * @public
 */
export type NoteResultType = Schema.Schema.Type<typeof NoteResult>;
type NoteRowType = Schema.Schema.Type<typeof NoteRowSchema>;

const renderNoteTable = (notes: ReadonlyArray<NoteRowType>): string => {
	const lines: string[] = ["| ID | Title | Scope | Project | Created |", "| --- | --- | --- | --- | --- |"];
	for (const n of notes) {
		const proj = n.project ?? "—";
		const created = n.createdAt.split("T")[0];
		lines.push(`| ${n.id} | ${n.title} | ${n.scope} | ${proj} | ${created} |`);
	}
	return lines.join("\n");
};

/**
 * Markdown rendering used at the boundary for note list/search
 * results. Mutations (create/get/update/delete) get JSON-stringify
 * via `structuredJsonResult` instead of a markdown view.
 */
export const formatNoteListMarkdown = (data: NoteResultType): string => {
	if (data.action === "list") {
		if (data.notes.length === 0) {
			return 'No notes found. Use note({ action: "create", ... }) to add notes.';
		}
		return ["## Notes", "", renderNoteTable(data.notes)].join("\n");
	}
	if (data.action === "search") {
		if (data.notes.length === 0) return "No notes matched.";
		return [`## Notes matching "${data.query}"`, "", renderNoteTable(data.notes)].join("\n");
	}
	// Non-list/search actions never reach this formatter; return JSON
	// for safety so the boundary cannot accidentally lose data.
	return JSON.stringify(data, null, 2);
};

/**
 * The text channel: list/search render markdown; the mutation actions
 * (create/get/update/delete) render the pretty-printed JSON, exactly as
 * the old `structuredJsonResult` boundary did.
 */
const renderNoteText = (data: NoteResultType): string =>
	data.action === "list" || data.action === "search" ? formatNoteListMarkdown(data) : JSON.stringify(data, null, 2);

const CreateVariant = Schema.Struct({
	action: Schema.Literal("create").annotate({ description: "CRUD discriminator" }),
	title: Schema.String,
	content: Schema.String,
	scope: NoteScope.annotate({ description: "create: required scope; list: optional filter" }),
	project: Schema.optionalKey(Schema.String),
	testFullName: Schema.optionalKey(Schema.String),
	modulePath: Schema.optionalKey(Schema.String),
	parentNoteId: Schema.optionalKey(Schema.Finite),
	createdBy: Schema.optionalKey(Schema.String),
	expiresAt: Schema.optionalKey(Schema.String),
	pinned: Schema.optionalKey(Schema.Boolean),
});

const ListVariant = Schema.Struct({
	action: Schema.Literal("list").annotate({ description: "CRUD discriminator" }),
	scope: Schema.optionalKey(NoteScope).annotate({ description: "create: required scope; list: optional filter" }),
	project: Schema.optionalKey(Schema.String),
	testFullName: Schema.optionalKey(Schema.String),
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite.annotate({ description: "get/update/delete: note id" }),
});

const UpdateVariant = Schema.Struct({
	action: Schema.Literal("update").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite.annotate({ description: "get/update/delete: note id" }),
	title: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(Schema.String),
	pinned: Schema.optionalKey(Schema.Boolean),
	expiresAt: Schema.optionalKey(Schema.String),
});

const DeleteVariant = Schema.Struct({
	action: Schema.Literal("delete").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite.annotate({ description: "get/update/delete: note id" }),
});

const SearchVariant = Schema.Struct({
	action: Schema.Literal("search").annotate({ description: "CRUD discriminator" }),
	query: Schema.String.annotate({ description: "search: FTS5 query" }),
});

/**
 * The `note` tool's parameters — a union discriminated on `action`.
 *
 * @public
 */
export const NoteParams = Schema.Union([
	CreateVariant,
	ListVariant,
	GetVariant,
	UpdateVariant,
	DeleteVariant,
	SearchVariant,
]);
/**
 * The decoded {@link NoteParams}.
 *
 * @public
 */
export type NoteParamsType = Schema.Schema.Type<typeof NoteParams>;

/**
 * Single source of truth for the `note` tool's `action` discriminant.
 * `served-enum-drift.test.ts` asserts the served `oneOf` members match
 * this tuple exactly, so the wire enum cannot drift from the input union
 * (issue #335).
 */
export const NOTE_ACTIONS = ["create", "list", "get", "update", "delete", "search"] as const;
type NoteAction = Schema.Schema.Type<typeof NoteParams>["action"];
type _AssertNoteActions = NoteAction extends (typeof NOTE_ACTIONS)[number]
	? (typeof NOTE_ACTIONS)[number] extends NoteAction
		? true
		: never
	: never;
const _assertNoteActions: _AssertNoteActions = true;
void _assertNoteActions;

/**
 * Handler for {@link noteTool}.
 *
 * @public
 */
export const handleNote = (input: NoteParamsType): Effect.Effect<NoteResultType, never, DataReader | DataStore> =>
	Match.value(input)
		.pipe(
			Match.discriminatorsExhaustive("action")({
				create: (variant) =>
					Effect.gen(function* () {
						const store = yield* DataStore;
						const noteInput = {
							title: variant.title,
							content: variant.content,
							scope: variant.scope,
							...(variant.project !== undefined && { project: variant.project }),
							...(variant.testFullName !== undefined && { testFullName: variant.testFullName }),
							...(variant.modulePath !== undefined && { modulePath: variant.modulePath }),
							...(variant.parentNoteId !== undefined && { parentNoteId: variant.parentNoteId }),
							...(variant.createdBy !== undefined && { createdBy: variant.createdBy }),
							...(variant.expiresAt !== undefined && { expiresAt: variant.expiresAt }),
							...(variant.pinned !== undefined && { pinned: variant.pinned }),
						};
						const id = yield* store.writeNote(noteInput);
						return { action: "create" as const, id };
					}),
				list: (variant) =>
					Effect.gen(function* () {
						const reader = yield* DataReader;
						const notes = yield* reader.getNotes(variant.scope, variant.project, variant.testFullName);
						return { action: "list" as const, count: notes.length, notes };
					}),
				get: (variant) =>
					Effect.gen(function* () {
						const reader = yield* DataReader;
						const noteOpt = yield* reader.getNoteById(variant.id);
						return Option.isNone(noteOpt)
							? { action: "get" as const, found: false as const, id: variant.id }
							: { action: "get" as const, found: true as const, note: noteOpt.value };
					}),
				update: (variant) =>
					Effect.gen(function* () {
						const store = yield* DataStore;
						const fields: Partial<NoteInput> = {
							...(variant.title !== undefined && { title: variant.title }),
							...(variant.content !== undefined && { content: variant.content }),
							...(variant.pinned !== undefined && { pinned: variant.pinned }),
							...(variant.expiresAt !== undefined && { expiresAt: variant.expiresAt }),
						};
						yield* store.updateNote(variant.id, fields);
						return { action: "update" as const, success: true as const };
					}),
				delete: (variant) =>
					Effect.gen(function* () {
						const store = yield* DataStore;
						yield* store.deleteNote(variant.id);
						return { action: "delete" as const, success: true as const };
					}),
				search: (variant) =>
					Effect.gen(function* () {
						const reader = yield* DataReader;
						const notes = yield* reader.searchNotes(variant.query);
						return { action: "search" as const, query: variant.query, count: notes.length, notes };
					}),
			}),
		)
		.pipe(Effect.orDie);

/**
 * The Effect-native `note` tool.
 *
 * @public
 */
export const noteTool = Tool.make("note", {
	description:
		"Use to manage notes, with a CRUD action discriminator: action='create' writes a scoped note; action='list' (scope?, project?, testFullName?) returns matching notes; action='get' (id) returns a structured note; action='update' (id, ...patch) edits; action='delete' (id) removes; action='search' (query) does FTS5 across title and content. structuredContent always carries the typed result (discriminate on `action`); list/search additionally render markdown in the text channel.",
	parameters: NoteParams,
	success: NoteResult,
	dependencies: [DataReader, DataStore],
})
	.annotate(Tool.Title, "Note")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, false)
	.annotate(RenderText, (encoded) => renderNoteText(encoded as NoteResultType));
