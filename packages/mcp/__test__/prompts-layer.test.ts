/**
 * The six framing prompts over the in-process stdio harness: `prompts/list`
 * serves exactly the registered names with the expected argument set and
 * required flags, and `prompts/get` returns the pure factories' user
 * messages — with `tdd-resume` defaulting its `sessionId` to the server's
 * recovered session context.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { tddResumePrompt } from "../src/prompts/tdd-resume.js";
import { wrapupPrompt } from "../src/prompts/wrapup.js";
import { McpSession } from "../src/session.js";
import type { HarnessOptions, JsonRpcMessage, McpHarness } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

interface PromptDescriptor {
	readonly name: string;
	readonly description?: string;
	readonly arguments?: ReadonlyArray<{
		readonly name: string;
		readonly description?: string;
		readonly required?: boolean;
	}>;
}

interface GetPromptResult {
	readonly description?: string;
	readonly messages: ReadonlyArray<{
		readonly role: string;
		readonly content: { readonly type: string; readonly text?: string };
	}>;
}

const withHarness = <A>(f: (harness: McpHarness) => Effect.Effect<A>, options?: HarnessOptions): Promise<A> =>
	Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness(options), f)));

const listPrompts = (): Promise<ReadonlyArray<PromptDescriptor>> =>
	withHarness((h) =>
		h.initialize().pipe(
			Effect.andThen(h.sendRequest("prompts/list")),
			Effect.map((m) => (m.result as { prompts: ReadonlyArray<PromptDescriptor> }).prompts),
		),
	);

const getPrompt = (name: string, args: Record<string, string>, options?: HarnessOptions): Promise<JsonRpcMessage> =>
	withHarness(
		(h) => h.initialize().pipe(Effect.andThen(h.sendRequest("prompts/get", { name, arguments: args }))),
		options,
	);

const argsOf = (prompt: PromptDescriptor | undefined) =>
	(prompt?.arguments ?? []).map((a) => ({ name: a.name, required: a.required === true }));

describe("prompts/list", () => {
	it("serves exactly the six framing prompts", async () => {
		const prompts = await listPrompts();
		expect(prompts.map((p) => p.name).sort()).toStrictEqual(
			["explain-failure", "regression-since-pass", "tdd-resume", "triage", "why-flaky", "wrapup"].sort(),
		);
		for (const prompt of prompts) expect(prompt.description, prompt.name).toBeTruthy();
	});

	it("declares each prompt's arguments with the pre-port required flags", async () => {
		const prompts = await listPrompts();
		const byName = new Map(prompts.map((p) => [p.name, p]));
		expect(argsOf(byName.get("triage"))).toStrictEqual([{ name: "project", required: false }]);
		expect(argsOf(byName.get("why-flaky"))).toStrictEqual([
			{ name: "test", required: true },
			{ name: "project", required: false },
		]);
		expect(argsOf(byName.get("regression-since-pass"))).toStrictEqual([
			{ name: "test", required: true },
			{ name: "project", required: false },
		]);
		expect(argsOf(byName.get("explain-failure"))).toStrictEqual([{ name: "signature", required: true }]);
		expect(argsOf(byName.get("tdd-resume"))).toStrictEqual([{ name: "sessionId", required: false }]);
		expect(argsOf(byName.get("wrapup"))).toStrictEqual([
			{ name: "kind", required: false },
			{ name: "since", required: false },
		]);
	});

	it("carries the argument descriptions through to the wire", async () => {
		const prompts = await listPrompts();
		const whyFlaky = prompts.find((p) => p.name === "why-flaky");
		expect(whyFlaky?.arguments?.find((a) => a.name === "test")?.description).toContain("hierarchical");
		const wrapup = prompts.find((p) => p.name === "wrapup");
		expect(wrapup?.arguments?.find((a) => a.name === "kind")?.description).toContain("user_prompt_nudge");
	});
});

describe("prompts/get", () => {
	it("wrapup {kind: stop} returns the factory's single user message verbatim", async () => {
		const response = await getPrompt("wrapup", { kind: "stop" });
		expect(response.error).toBeUndefined();
		const result = response.result as GetPromptResult;
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("user");
		expect(result.messages[0]?.content.type).toBe("text");
		expect(result.messages[0]?.content.text).toBe(wrapupPrompt({ kind: "stop" }).messages[0]?.content.text);
		expect(result.messages[0]?.content.text).toContain('kind: "stop"');
	});

	it("wrapup with no arguments defaults to user_prompt_nudge", async () => {
		const response = await getPrompt("wrapup", {});
		const result = response.result as GetPromptResult;
		expect(result.messages[0]?.content.text).toContain('kind: "user_prompt_nudge"');
	});

	it("wrapup rejects an unknown kind with a JSON-RPC invalid-params error", async () => {
		const response = await getPrompt("wrapup", { kind: "bogus" });
		expect(response.result).toBeUndefined();
		const error = response.error as { code: number; message: string };
		expect(error.code).toBe(-32602);
		// An unregistered prompt is ALSO -32602 ("Prompt 'x' not found"); pin the params path.
		expect(error.message).not.toContain("not found");
	});

	it("why-flaky threads the required test name and the optional project", async () => {
		const response = await getPrompt("why-flaky", { test: "Suite > flaky one", project: "pkg-a" });
		const result = response.result as GetPromptResult;
		expect(result.messages[0]?.content.text).toContain("Suite > flaky one");
		expect(result.messages[0]?.content.text).toContain("pkg-a");
	});

	it("why-flaky without the required test argument is an invalid-params error", async () => {
		const response = await getPrompt("why-flaky", {});
		expect((response.error as { code: number }).code).toBe(-32602);
	});

	it("tdd-resume {} defaults sessionId to the session's recovered chat id", async () => {
		const chatId = "chat-recovered-7f3a";
		const session = McpSession.layerTest({
			cwd: process.cwd(),
			initialSessionId: chatId,
			initialContext: { chatId, conversationId: "conv-1", mainAgentId: "agent-1" },
		});
		const response = await getPrompt("tdd-resume", {}, { session });
		const result = response.result as GetPromptResult;
		expect(result.messages[0]?.content.text).toBe(tddResumePrompt({ sessionId: chatId }).messages[0]?.content.text);
		expect(result.messages[0]?.content.text).toContain(chatId);
	});

	it("tdd-resume {} with no recovered context falls back to the inferred-session wording", async () => {
		const response = await getPrompt("tdd-resume", {});
		const result = response.result as GetPromptResult;
		expect(result.messages[0]?.content.text).toBe(tddResumePrompt({}).messages[0]?.content.text);
	});

	it("tdd-resume honors an explicit sessionId over the recovered one", async () => {
		const session = McpSession.layerTest({
			cwd: process.cwd(),
			initialContext: { chatId: "chat-recovered", conversationId: "conv-1", mainAgentId: "agent-1" },
		});
		const response = await getPrompt("tdd-resume", { sessionId: "sess-explicit" }, { session });
		const result = response.result as GetPromptResult;
		expect(result.messages[0]?.content.text).toContain("sess-explicit");
		expect(result.messages[0]?.content.text).not.toContain("chat-recovered");
	});
});
