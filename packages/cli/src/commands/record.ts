/**
 * CLI record command -- write session/turn data to the database.
 *
 * Hook scripts in plugin/hooks/ shell out to these subcommands. The
 * record-turn and record-session libs (in ../lib) implement the actual
 * write effects; commands here are thin \@effect/cli wrappers.
 *
 * @packageDocumentation
 */

import { Args, Command, Options } from "@effect/cli";
import type { ArtifactKind, ChangeKind, RunInvocationMethod } from "@vitest-agent/sdk";
import { DataReader, DataStore } from "@vitest-agent/sdk";
import { Effect, Option } from "effect";
import { recordSessionEnd, recordSessionStart } from "../lib/record-session.js";
import { recordTddArtifactEffect } from "../lib/record-tdd-artifact.js";
import { recordTurnEffect } from "../lib/record-turn.js";
import { recordRunWorkspaceChangesEffect } from "../lib/record-workspace-changes.js";

const chatId = Options.text("chat-id").pipe(
	Options.withDescription("Host chat id (`session_id` in the Claude Code hook envelope; equivalent in other clients)"),
);

const occurredAt = Options.text("occurred-at").pipe(
	Options.withDefault(new Date().toISOString()),
	Options.withDescription("ISO 8601 timestamp; defaults to now"),
);

const payloadArg = Args.text({ name: "payload-json" }).pipe(
	Args.withDescription("Stringified JSON payload (validated against TurnPayload)"),
);

const project = Options.text("project");
const cwd = Options.text("cwd");
const projectOptional = Options.optional(Options.text("project"));
const cwdOptional = Options.optional(Options.text("cwd"));

const turnSubcommand = Command.make(
	"turn",
	{ chatId, occurredAt, project: projectOptional, cwd: cwdOptional, payload: payloadArg },
	({ chatId, occurredAt, project, cwd, payload }) =>
		recordTurnEffect({
			chatId,
			payloadJson: payload,
			occurredAt,
			...(project._tag === "Some" && { project: project.value }),
			...(cwd._tag === "Some" && { cwd: cwd.value }),
		}).pipe(
			Effect.flatMap((result) => Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`))),
			Effect.catchAll((err) =>
				Effect.sync(() => {
					process.stderr.write(`record turn: ${err instanceof Error ? err.message : String(err)}\n`);
					process.exit(1);
				}),
			),
		),
).pipe(Command.withDescription("Validate a TurnPayload JSON and write a turn row"));
const agentKind = Options.choice("agent-kind", ["main", "subagent"]).pipe(Options.withDefault("main"));
const agentType = Options.optional(Options.text("agent-type"));
const parentChatId = Options.optional(Options.text("parent-chat-id"));
const triageWasNonEmpty = Options.boolean("triage-was-non-empty").pipe(Options.withDefault(false));
const startedAt = Options.text("started-at").pipe(Options.withDefault(new Date().toISOString()));

const sessionStartSubcommand = Command.make(
	"session-start",
	{
		chatId,
		project,
		cwd,
		agentKind,
		agentType,
		parentChatId,
		triageWasNonEmpty,
		startedAt,
	},
	(opts) =>
		recordSessionStart({
			chatId: opts.chatId,
			project: opts.project,
			cwd: opts.cwd,
			agentKind: opts.agentKind as "main" | "subagent",
			...(opts.agentType._tag === "Some" && { agentType: opts.agentType.value }),
			...(opts.parentChatId._tag === "Some" && {
				parentChatId: opts.parentChatId.value,
			}),
			triageWasNonEmpty: opts.triageWasNonEmpty,
			startedAt: opts.startedAt,
		}).pipe(
			Effect.flatMap((result) => Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`))),
			Effect.catchAll((err) =>
				Effect.sync(() => {
					process.stderr.write(`record session-start: ${err instanceof Error ? err.message : String(err)}\n`);
					process.exit(1);
				}),
			),
		),
).pipe(Command.withDescription("Insert a new sessions row"));

const endedAt = Options.text("ended-at").pipe(Options.withDefault(new Date().toISOString()));
const endReason = Options.optional(Options.text("end-reason"));

const sessionEndSubcommand = Command.make("session-end", { chatId, endedAt, endReason }, (opts) =>
	recordSessionEnd({
		chatId: opts.chatId,
		endedAt: opts.endedAt,
		endReason: opts.endReason._tag === "Some" ? opts.endReason.value : null,
	}).pipe(
		Effect.flatMap(() => Effect.sync(() => process.stdout.write(`{"ok":true}\n`))),
		Effect.catchAll((err) =>
			Effect.sync(() => {
				process.stderr.write(`record session-end: ${err instanceof Error ? err.message : String(err)}\n`);
				process.exit(1);
			}),
		),
	),
).pipe(Command.withDescription("Update sessions.ended_at + end_reason"));

const artifactKindOpt = Options.choice("artifact-kind", [
	"test_written",
	"test_failed_run",
	"code_written",
	"test_passed_run",
	"refactor",
	"test_weakened",
]);
const filePathOpt = Options.optional(Options.text("file-path"));
const testCaseIdOpt = Options.optional(Options.integer("test-case-id"));
const testRunIdOpt = Options.optional(Options.integer("test-run-id"));
const testFirstFailureRunIdOpt = Options.optional(Options.integer("test-first-failure-run-id"));
const diffExcerptOpt = Options.optional(Options.text("diff-excerpt"));
const recordedAtOpt = Options.text("recorded-at").pipe(Options.withDefault(new Date().toISOString()));

const tddArtifactSubcommand = Command.make(
	"tdd-artifact",
	{
		chatId,
		project: projectOptional,
		cwd: cwdOptional,
		artifactKind: artifactKindOpt,
		filePath: filePathOpt,
		testCaseId: testCaseIdOpt,
		testRunId: testRunIdOpt,
		testFirstFailureRunId: testFirstFailureRunIdOpt,
		diffExcerpt: diffExcerptOpt,
		recordedAt: recordedAtOpt,
	},
	(opts) =>
		Effect.gen(function* () {
			// Resolve filePath -> fileId via DataStore.ensureFile if provided.
			let fileId: number | undefined;
			if (opts.filePath._tag === "Some") {
				const ds = yield* DataStore;
				fileId = yield* ds.ensureFile(opts.filePath.value);
			}
			return yield* recordTddArtifactEffect({
				chatId: opts.chatId,
				...(opts.project._tag === "Some" && { project: opts.project.value }),
				...(opts.cwd._tag === "Some" && { cwd: opts.cwd.value }),
				artifactKind: opts.artifactKind as ArtifactKind,
				...(fileId !== undefined && { fileId }),
				...(opts.testCaseId._tag === "Some" && { testCaseId: opts.testCaseId.value }),
				...(opts.testRunId._tag === "Some" && { testRunId: opts.testRunId.value }),
				...(opts.testFirstFailureRunId._tag === "Some" && {
					testFirstFailureRunId: opts.testFirstFailureRunId.value,
				}),
				...(opts.diffExcerpt._tag === "Some" && { diffExcerpt: opts.diffExcerpt.value }),
				recordedAt: opts.recordedAt,
			});
		}).pipe(
			Effect.flatMap((result) => Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`))),
			Effect.catchAll((err) =>
				Effect.sync(() => {
					process.stderr.write(`record tdd-artifact: ${err instanceof Error ? err.message : String(err)}\n`);
					process.exit(1);
				}),
			),
		),
).pipe(Command.withDescription("Record a TDD artifact (D7: CLI-only)"));

const testCaseTurnsSubcommand = Command.make("test-case-turns", { chatId }, ({ chatId }) =>
	Effect.gen(function* () {
		const store = yield* DataStore;
		const reader = yield* DataReader;
		const updated = yield* store.backfillTestCaseTurns(chatId);
		const latestId = yield* reader.getLatestTestCaseForSession(chatId);
		return { updated, latestTestCaseId: Option.getOrNull(latestId) };
	}).pipe(
		Effect.flatMap((result) => Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`))),
		Effect.catchAll((err) =>
			Effect.sync(() => {
				process.stderr.write(`record test-case-turns: ${err instanceof Error ? err.message : String(err)}\n`);
				process.exit(1);
			}),
		),
	),
).pipe(
	Command.withDescription("Backfill test_cases.created_turn_id from file_edits in the current session (BUG-2 fix)"),
);

const invocationMethodOpt = Options.choice("invocation-method", ["bash", "mcp", "cli"]).pipe(
	Options.withDescription('How tests were invoked: "bash", "mcp", or "cli"'),
	Options.withDefault("bash"),
);

const runTriggerSubcommand = Command.make(
	"run-trigger",
	{ chatId, invocationMethod: invocationMethodOpt },
	({ chatId, invocationMethod }) =>
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.associateLatestRunWithSession({
				chatId,
				invocationMethod: invocationMethod as RunInvocationMethod,
			});
		}).pipe(
			Effect.catchAll((err) =>
				Effect.sync(() => {
					process.stderr.write(`record run-trigger: ${err instanceof Error ? err.message : String(err)}\n`);
					process.exit(1);
				}),
			),
		),
).pipe(Command.withDescription("Associate the latest test run with the current Claude Code session"));

const shaOpt = Options.text("sha");
const parentShaOpt = Options.optional(Options.text("parent-sha"));
const messageOpt = Options.optional(Options.text("message"));
const authorOpt = Options.optional(Options.text("author"));
const committedAtOpt = Options.optional(Options.text("committed-at"));
const branchOpt = Options.optional(Options.text("branch"));
const projectOpt = Options.optional(Options.text("project"));
const filesArg = Args.text({ name: "files-json" }).pipe(
	Args.withDescription('JSON array of {"filePath","changeKind"} objects'),
);

const runWorkspaceChangesSubcommand = Command.make(
	"run-workspace-changes",
	{
		sha: shaOpt,
		parentSha: parentShaOpt,
		message: messageOpt,
		author: authorOpt,
		committedAt: committedAtOpt,
		branch: branchOpt,
		project: projectOpt,
		files: filesArg,
	},
	(opts) =>
		Effect.gen(function* () {
			const parsed = yield* Effect.try({
				try: () =>
					JSON.parse(opts.files) as ReadonlyArray<{
						filePath: string;
						changeKind: ChangeKind;
					}>,
				catch: (e) => new Error(`Invalid files-json: ${e instanceof Error ? e.message : String(e)}`),
			});
			return yield* recordRunWorkspaceChangesEffect({
				sha: opts.sha,
				...(opts.parentSha._tag === "Some" && { parentSha: opts.parentSha.value }),
				...(opts.message._tag === "Some" && { message: opts.message.value }),
				...(opts.author._tag === "Some" && { author: opts.author.value }),
				...(opts.committedAt._tag === "Some" && { committedAt: opts.committedAt.value }),
				...(opts.branch._tag === "Some" && { branch: opts.branch.value }),
				...(opts.project._tag === "Some" && { project: opts.project.value }),
				files: parsed,
			});
		}).pipe(
			Effect.flatMap((result) => Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`))),
			Effect.catchAll((err) =>
				Effect.sync(() => {
					process.stderr.write(`record run-workspace-changes: ${err instanceof Error ? err.message : String(err)}\n`);
					process.exit(1);
				}),
			),
		),
).pipe(Command.withDescription("Record a commit + its changed files (driven by post-commit hook)"));

export const recordCommand = Command.make("record").pipe(
	Command.withSubcommands([
		turnSubcommand,
		sessionStartSubcommand,
		sessionEndSubcommand,
		tddArtifactSubcommand,
		runWorkspaceChangesSubcommand,
		runTriggerSubcommand,
		testCaseTurnsSubcommand,
	]),
	Command.withDescription(
		"Hook write surface (Decision D3): turn, session-start, session-end, tdd-artifact, run-workspace-changes",
	),
);
