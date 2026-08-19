import { describe, expect, test } from "bun:test";
import { createPstackExtension } from "../src/extension.ts";
import { normalizeResponsesToolTurns } from "../src/pstack-task.ts";
import { createFakeRuntime, type FakeRuntime } from "./helpers/runtime-fake-api.ts";

/**
 * Root cause (reproduced against opencode-go's Console Go relay for
 * deepseek-v4-flash): a Responses request whose assistant `message` narration
 * sits between a `function_call` and its `function_call_output` is rejected with
 * `No tool output found for tool call <id>`. The captured 400 replays 400 as-is
 * and 200 once each tool turn is re-grouped. These tests pin that transform and
 * its `before_provider_request` wiring.
 */

type Item = { type?: string; role?: string; call_id?: string };

const types = (input: unknown): Array<string | undefined> =>
	(input as Item[]).map((item) => item.type);

const fnCall = (id: string): Item => ({ type: "function_call", call_id: id });
const fnOutput = (id: string): Item => ({ type: "function_call_output", call_id: id });
const assistantText = (): Item => ({ type: "message", role: "assistant" });
const reasoning = (): Item => ({ type: "reasoning" });
const userTurn = (): Item => ({ type: "message", role: "user" });

describe("normalizeResponsesToolTurns", () => {
	test("hoists an assistant message interposed between two calls ahead of the call run", () => {
		const body = {
			model: "deepseek-v4-flash",
			input: [
				userTurn(),
				fnCall("a"),
				assistantText(),
				fnCall("b"),
				fnOutput("a"),
				fnOutput("b"),
			],
		};
		const result = normalizeResponsesToolTurns(body) as { input: Item[] };
		expect(types(result.input)).toEqual([
			"message", // user turn
			"message", // hoisted assistant narration
			"function_call",
			"function_call",
			"function_call_output",
			"function_call_output",
		]);
	});

	test("hoists an assistant message sitting between the calls and their outputs", () => {
		const body = {
			input: [fnCall("a"), fnCall("b"), assistantText(), fnOutput("a"), fnOutput("b")],
		};
		const result = normalizeResponsesToolTurns(body) as { input: Item[] };
		expect(types(result.input)).toEqual([
			"message",
			"function_call",
			"function_call",
			"function_call_output",
			"function_call_output",
		]);
	});

	test("re-groups the captured shape: many calls with interleaved narration, outputs deferred to the end", () => {
		const input: Item[] = [
			assistantText(),
			fnCall("a"),
			fnCall("b"),
			assistantText(),
			fnCall("c"),
			fnOutput("a"),
			fnOutput("b"),
			fnOutput("c"),
		];
		const result = normalizeResponsesToolTurns({ input }) as { input: Item[] };
		// No assistant message may remain between a call and the outputs.
		const firstCall = result.input.findIndex((item) => item.type === "function_call");
		const lastOutput = result.input.reduce(
			(last, item, i) => (item.type === "function_call_output" ? i : last),
			-1,
		);
		const interposed = result.input
			.slice(firstCall, lastOutput)
			.some((item) => item.type === "message");
		expect(interposed).toBe(false);
		expect(types(result.input)).toEqual([
			"message",
			"message",
			"function_call",
			"function_call",
			"function_call",
			"function_call_output",
			"function_call_output",
			"function_call_output",
		]);
	});

	test("leaves a well-formed turn untouched (returns undefined)", () => {
		const body = {
			input: [reasoning(), assistantText(), fnCall("a"), fnCall("b"), fnOutput("a"), fnOutput("b")],
		};
		expect(normalizeResponsesToolTurns(body)).toBeUndefined();
	});

	test("never merges distinct sequential tool turns", () => {
		const body = {
			input: [
				reasoning(),
				fnCall("a"),
				fnOutput("a"),
				reasoning(),
				fnCall("b"),
				fnOutput("b"),
			],
		};
		expect(normalizeResponsesToolTurns(body)).toBeUndefined();
	});

	test("ignores non-Responses payloads (chat/messages shape or non-objects)", () => {
		expect(normalizeResponsesToolTurns({ messages: [] })).toBeUndefined();
		expect(normalizeResponsesToolTurns(undefined)).toBeUndefined();
		expect(normalizeResponsesToolTurns("nope")).toBeUndefined();
		expect(normalizeResponsesToolTurns({ input: "not-an-array" })).toBeUndefined();
	});
});

describe("before_provider_request wiring", () => {
	function loadExtension(runtime: FakeRuntime): void {
		createPstackExtension()(runtime.api as never);
	}

	test("the extension registers a before_provider_request handler that re-groups tool turns", () => {
		const runtime = createFakeRuntime();
		loadExtension(runtime);
		const handler = runtime.handlers.get("before_provider_request")?.[0];
		expect(typeof handler).toBe("function");

		const payload = {
			input: [fnCall("a"), assistantText(), fnCall("b"), fnOutput("a"), fnOutput("b")],
		};
		const result = handler?.({ type: "before_provider_request", payload }, undefined) as {
			input: Item[];
		};
		expect(types(result.input)).toEqual([
			"message",
			"function_call",
			"function_call",
			"function_call_output",
			"function_call_output",
		]);
	});

	test("the handler returns undefined for an already well-formed request", () => {
		const runtime = createFakeRuntime();
		loadExtension(runtime);
		const handler = runtime.handlers.get("before_provider_request")?.[0];
		const payload = { input: [fnCall("a"), fnOutput("a")] };
		expect(handler?.({ type: "before_provider_request", payload }, undefined)).toBeUndefined();
	});
});
