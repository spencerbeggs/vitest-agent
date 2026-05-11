/**
 * Consolidated `note` MCP tool — Schema-driven implementation.
 *
 * Every action now returns a structured object; the boundary in
 * server.ts renders markdown for `list` / `search` callers via the
 * exported `formatNoteListMarkdown` helper. The mutation actions
 * (`create`, `update`, `delete`, `get`) carry their previous shapes.
 *
 * @packageDocumentation
 */

import { Effect, Match, Option, Schema } from "effect";
import type { NoteInput } from "vitest-agent-sdk";
import { DataReader, DataStore } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

const NoteScope = Schema.Literal("global", "project", "module", "suite", "test", "note");

const NoteRowSchema = Schema.Struct({
	id: Schema.Number.annotations({ description: "Note primary key." }),
	title: Schema.String,
	content: Schema.String,
	scope: NoteScope.annotations({
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
}).annotations({ identifier: "NoteRow" });

const NoteCreateOk = Schema.Struct({
	action: Schema.Literal("create"),
	id: Schema.Number.annotations({ description: "Primary key of the newly inserted note." }),
});

const NoteListOk = Schema.Struct({
	action: Schema.Literal("list"),
	count: Schema.Number,
	notes: Schema.Array(NoteRowSchema).annotations({
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
	notes: Schema.Array(NoteRowSchema).annotations({ description: "Notes whose title or content match the FTS5 query." }),
});

export const NoteResult = Schema.Union(
	NoteCreateOk,
	NoteListOk,
	NoteGetFound,
	NoteGetMissing,
	NoteUpdateOk,
	NoteDeleteOk,
	NoteSearchOk,
).annotations({
	identifier: "NoteResult",
	title: "note result",
	description: "Discriminate on `action`. `get` further discriminates on `found`.",
});
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

const CreateVariant = Schema.Struct({
	action: Schema.Literal("create"),
	title: Schema.String,
	content: Schema.String,
	scope: NoteScope,
	project: Schema.optional(Schema.String),
	testFullName: Schema.optional(Schema.String),
	modulePath: Schema.optional(Schema.String),
	parentNoteId: Schema.optional(Schema.Number),
	createdBy: Schema.optional(Schema.String),
	expiresAt: Schema.optional(Schema.String),
	pinned: Schema.optional(Schema.Boolean),
});

const ListVariant = Schema.Struct({
	action: Schema.Literal("list"),
	scope: Schema.optional(Schema.String),
	project: Schema.optional(Schema.String),
	testFullName: Schema.optional(Schema.String),
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get"),
	id: Schema.Number,
});

const UpdateVariant = Schema.Struct({
	action: Schema.Literal("update"),
	id: Schema.Number,
	title: Schema.optional(Schema.String),
	content: Schema.optional(Schema.String),
	pinned: Schema.optional(Schema.Boolean),
	expiresAt: Schema.optional(Schema.String),
});

const DeleteVariant = Schema.Struct({
	action: Schema.Literal("delete"),
	id: Schema.Number,
});

const SearchVariant = Schema.Struct({
	action: Schema.Literal("search"),
	query: Schema.String,
});

const NoteInputUnion = Schema.Union(
	CreateVariant,
	ListVariant,
	GetVariant,
	UpdateVariant,
	DeleteVariant,
	SearchVariant,
);

export const note = publicProcedure
	.input(Schema.standardSchemaV1(NoteInputUnion))
	.mutation(async ({ ctx, input }): Promise<NoteResultType> => {
		return ctx.runtime.runPromise(
			Match.value(input).pipe(
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
			),
		);
	});
