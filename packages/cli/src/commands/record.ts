/**
 * CLI record command -- write session/turn data to the database.
 *
 * Hook scripts in plugin/hooks/ shell out to these subcommands. The
 * record-turn and record-session libs (in ../lib) implement the actual
 * write effects; commands here are thin `effect/unstable/cli` wrappers.
 *
 * @packageDocumentation
 */

import type { ArtifactKind, ChangeKind, RunInvocationMethod } from "@vitest-agent/sdk";
import { DataReader, DataStore } from "@vitest-agent/sdk";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { recordSessionEnd, recordSessionStart } from "../lib/record-session.js";
import { recordTddArtifactEffect } from "../lib/record-tdd-artifact.js";
import { recordTurnEffect } from "../lib/record-turn.js";
import { recordRunWorkspaceChangesEffect } from "../lib/record-workspace-changes.js";

const chatId = Flag.string("chat-id").pipe(
	Flag.withDescription("Host chat id (`session_id` in the Claude Code hook envelope; equivalent in other clients)"),
);

const occurredAt = Flag.string("occurred-at").pipe(
	Flag.withDefault(new Date().toISOString()),
	Flag.withDescription("ISO 8601 timestamp; defaults to now"),
);

const payloadArg = Argument.string("payload-json").pipe(
	Argument.withDescription("Stringified JSON payload (validated against TurnPayload)"),
);

const project = Flag.string("project");
const cwd = Flag.string("cwd");
const projectOptional = Flag.optional(Flag.string("project"));
const cwdOptional = Flag.optional(Flag.string("cwd"));

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
			Effect.catch((err) =>
				Effect.sync(() => {
					process.stderr.write(`record turn: ${err instanceof Error ? err.message : String(err)}\n`);
					process.exit(1);
				}),
			),
		),
).pipe(Command.withDescription("Validate a TurnPayload JSON and write a turn row"));
const agentKind = Flag.choice("agent-kind", ["main", "subagent"]).pipe(Flag.withDefault("main"));
const agentType = Flag.optional(Flag.string("agent-type"));
const parentChatId = Flag.optional(Flag.string("parent-chat-id"));
const triageWasNonEmpty = Flag.boolean("triage-was-non-empty").pipe(Flag.withDefault(false));
const startedAt = Flag.string("started-at").pipe(Flag.withDefault(new Date().toISOString()));

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
			Effect.catch((err) =>
				Effect.sync(() => {
					process.stderr.write(`record session-start: ${err instanceof Error ? err.message : String(err)}\n`);
					process.exit(1);
				}),
			),
		),
).pipe(Command.withDescription("Insert a new sessions row"));

const endedAt = Flag.string("ended-at").pipe(Flag.withDefault(new Date().toISOString()));
const endReason = Flag.optional(Flag.string("end-reason"));

const sessionEndSubcommand = Command.make("session-end", { chatId, endedAt, endReason }, (opts) =>
	recordSessionEnd({
		chatId: opts.chatId,
		endedAt: opts.endedAt,
		endReason: opts.endReason._tag === "Some" ? opts.endReason.value : null,
	}).pipe(
		Effect.flatMap(() => Effect.sync(() => process.stdout.write(`{"ok":true}\n`))),
		Effect.catch((err) =>
			Effect.sync(() => {
				process.stderr.write(`record session-end: ${err instanceof Error ? err.message : String(err)}\n`);
				process.exit(1);
			}),
		),
	),
).pipe(Command.withDescription("Update sessions.ended_at + end_reason"));

const artifactKindOpt = Flag.choice("artifact-kind", [
	"test_written",
	"test_failed_run",
	"code_written",
	"test_passed_run",
	"refactor",
	"test_weakened",
]);
const filePathOpt = Flag.optional(Flag.string("file-path"));
const testCaseIdOpt = Flag.optional(Flag.integer("test-case-id"));
const testRunIdOpt = Flag.optional(Flag.integer("test-run-id"));
const testFirstFailureRunIdOpt = Flag.optional(Flag.integer("test-first-failure-run-id"));
const diffExcerptOpt = Flag.optional(Flag.string("diff-excerpt"));
const recordedAtOpt = Flag.string("recorded-at").pipe(Flag.withDefault(new Date().toISOString()));

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
			Effect.catch((err) =>
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
		Effect.catch((err) =>
			Effect.sync(() => {
				process.stderr.write(`record test-case-turns: ${err instanceof Error ? err.message : String(err)}\n`);
				process.exit(1);
			}),
		),
	),
).pipe(
	Command.withDescription("Backfill test_cases.created_turn_id from file_edits in the current session (BUG-2 fix)"),
);

const invocationMethodOpt = Flag.choice("invocation-method", ["bash", "mcp", "cli"]).pipe(
	Flag.withDescription('How tests were invoked: "bash", "mcp", or "cli"'),
	Flag.withDefault("bash"),
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
			Effect.catch((err) =>
				Effect.sync(() => {
					process.stderr.write(`record run-trigger: ${err instanceof Error ? err.message : String(err)}\n`);
					process.exit(1);
				}),
			),
		),
).pipe(Command.withDescription("Associate the latest test run with the current Claude Code session"));

const shaOpt = Flag.string("sha");
const parentShaOpt = Flag.optional(Flag.string("parent-sha"));
const messageOpt = Flag.optional(Flag.string("message"));
const authorOpt = Flag.optional(Flag.string("author"));
const committedAtOpt = Flag.optional(Flag.string("committed-at"));
const branchOpt = Flag.optional(Flag.string("branch"));
const projectOpt = Flag.optional(Flag.string("project"));
const filesArg = Argument.string("files-json").pipe(
	Argument.withDescription('JSON array of {"filePath","changeKind"} objects'),
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
			Effect.catch((err) =>
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
