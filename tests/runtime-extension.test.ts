import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BUNDLED_TEAM_KIT_COMMANDS,
	OTHER_PSTACK_DIRECT_SKILL_COMMANDS,
	PSTACK_DIRECT_SKILL_COMMANDS,
	PSTACK_MODE_ENTRY_TYPE,
	PSTACK_MODEL_RULE_BASENAME,
	PSTACK_SESSION_COMMANDS,
} from "./helpers/runtime-expected-commands.ts";
import { createFakeRuntime, type FakeRuntime } from "./helpers/runtime-fake-api.ts";
import { isStrictTextOutputSchema } from "./helpers/runtime-output-schema.ts";

// Public seams under test (absent until the green implementation lands).
import pstackExtension, {
	createPstackExtension,
	type PstackExtensionOptions,
} from "../src/extension.ts";
import {
	executeAssignments,
	expandAssignments,
	resolveModelOverride,
	type RunSubprocessFn,
} from "../src/pstack-task.ts";

// Fixture skill body must be longer than the sticky reminder so the
// "short reminder" assertion can distinguish full prompt vs reminder.
const POTETO_SKILL_BODY = `# Poteto mode

## Non-negotiables

Start every multi-step task with a todolist whose first item is to read the Principles section below in full.

## Principles

Apply principle-laziness-protocol, principle-prove-it-works, and principle-never-block-on-the-human when they match the current turn. Name each principle that shaped a decision.

## Autonomy

Just do it. Proceed on reversible work and present the result instead of asking for permission first.
`;

const POTETO_REMINDER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

function writePackageFixture(root: string): void {
	mkdirSync(join(root, "skills", "poteto-mode"), { recursive: true });
	writeFileSync(
		join(root, "skills", "poteto-mode", "SKILL.md"),
		[
			"---",
			"name: Poteto Mode",
			"description: poteto mode",
			"mode: true",
			`reminder: ${POTETO_REMINDER}`,
			"---",
			"",
			POTETO_SKILL_BODY,
		].join("\n"),
		"utf8",
	);
}

function loadExtension(runtime: FakeRuntime, options: PstackExtensionOptions = {}): void {
	const factory = createPstackExtension(options);
	factory(runtime.api as never);
}

test("default export is an ExtensionAPI factory", () => {
	expect(typeof pstackExtension).toBe("function");
	expect(typeof createPstackExtension).toBe("function");
});

function latestModeEntry(runtime: FakeRuntime): { state?: string } | undefined {
	const matches = runtime.entries.filter(
		(entry) => entry.type === "custom" && entry.customType === PSTACK_MODE_ENTRY_TYPE,
	);
	const latest = matches.at(-1);
	return latest?.data as { state?: string } | undefined;
}

function messageText(payload: unknown): string {
	if (typeof payload === "string") return payload;
	if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		if (typeof record.content === "string") return record.content;
		if (Array.isArray(record.content)) {
			return record.content
				.map((part) => {
					if (typeof part === "string") return part;
					if (part && typeof part === "object" && "text" in part) {
						return String((part as { text?: unknown }).text ?? "");
					}
					return "";
				})
				.join("\n");
		}
		if (typeof record.text === "string") return record.text;
	}
	return JSON.stringify(payload);
}

describe("omp-pstack runtime extension", () => {
	let packageRoot: string;
	let homeDir: string;
	let runtime: FakeRuntime;

	beforeEach(() => {
		packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-pkg-"));
		homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-home-"));
		writePackageFixture(packageRoot);
		runtime = createFakeRuntime({ cwd: packageRoot });
	});

	afterEach(() => {
		rmSync(packageRoot, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
	});

	test("registers poteto-mode, the other 22 P-Stack direct skills, bundled team-kit skills, and session commands unprefixed", () => {
		loadExtension(runtime, { packageRoot, homeDir });

		expect(PSTACK_DIRECT_SKILL_COMMANDS).toHaveLength(23);
		expect(OTHER_PSTACK_DIRECT_SKILL_COMMANDS).toHaveLength(22);
		expect(runtime.commands.has("poteto-mode")).toBe(true);
		for (const name of OTHER_PSTACK_DIRECT_SKILL_COMMANDS) {
			expect(runtime.commands.has(name)).toBe(true);
		}
		for (const name of PSTACK_DIRECT_SKILL_COMMANDS) {
			expect(runtime.commands.has(name)).toBe(true);
		}
		for (const name of BUNDLED_TEAM_KIT_COMMANDS) {
			expect(runtime.commands.has(name)).toBe(true);
		}
		for (const name of PSTACK_SESSION_COMMANDS) {
			expect(runtime.commands.has(name)).toBe(true);
		}

		// Skill and team-kit aliases are unprefixed; session controls intentionally use pstack-*.
		for (const name of [...PSTACK_DIRECT_SKILL_COMMANDS, ...BUNDLED_TEAM_KIT_COMMANDS]) {
			expect(name.startsWith("pstack-")).toBe(false);
			expect(name.includes("/")).toBe(false);
		}
	});

	test("/poteto-mode ARG persists an ON custom entry and sends the full skill prompt with ARG", async () => {
		loadExtension(runtime, { packageRoot, homeDir });

		await runtime.invokeCommand("poteto-mode", "ship the watcher");

		expect(latestModeEntry(runtime)).toEqual({ state: "ON" });

		const texts = runtime.sentMessages.map((message) => messageText(message.payload));
		expect(texts.length).toBeGreaterThan(0);
		expect(texts.some((text) => text.includes(POTETO_SKILL_BODY.trim()) && text.includes("ship the watcher"))).toBe(
			true,
		);
	});

	test("/pstack-off persists an OFF custom entry", async () => {
		loadExtension(runtime, { packageRoot, homeDir });

		await runtime.invokeCommand("poteto-mode", "focus");
		await runtime.invokeCommand("pstack-off");

		expect(latestModeEntry(runtime)).toEqual({ state: "OFF" });
	});

	test("session reconstruction uses the most recent pstack-mode state entry", async () => {
		const seeded = createFakeRuntime({
			cwd: packageRoot,
			initialEntries: [
				{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "ON" } },
				{ type: "custom", customType: "unrelated", data: { ok: true } },
				{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "OFF" } },
			],
		});
		loadExtension(seeded, { packageRoot, homeDir });

		await seeded.emitSessionStart();
		const result = await seeded.emitBeforeAgentStart(["base-system"]);
		// Most recent state is OFF, so no active-mode reminder is appended.
		expect(result?.systemPrompt ?? ["base-system"]).toEqual(["base-system"]);

		const onRuntime = createFakeRuntime({
			cwd: packageRoot,
			initialEntries: [
				{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "OFF" } },
				{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "ON" } },
			],
		});
		loadExtension(onRuntime, { packageRoot, homeDir });
		await onRuntime.emitSessionStart();
		const onResult = await onRuntime.emitBeforeAgentStart(["base-system"]);
		expect(onResult?.systemPrompt).toBeDefined();
		expect(onResult!.systemPrompt![0]).toBe("base-system");
		expect(onResult!.systemPrompt!.length).toBeGreaterThan(1);
	});

	test("session_switch, session_branch, and session_tree reconstruct sticky mode without leakage", async () => {
		loadExtension(runtime, { packageRoot, homeDir });
		await runtime.invokeCommand("poteto-mode", "armed");

		// Switch into a session whose latest sticky entry is OFF.
		runtime.replaceEntries([
			{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "OFF" } },
		]);
		await runtime.emitSessionSwitch("resume");
		const switchedOff = await runtime.emitBeforeAgentStart(["base-system"]);
		expect(switchedOff?.systemPrompt ?? ["base-system"]).toEqual(["base-system"]);
		await runtime.invokeCommand("pstack-status");
		expect(runtime.notifications.at(-1)?.message).toContain("OFF");

		// Branch into a session whose latest sticky entry is ON.
		runtime.replaceEntries([
			{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "ON" } },
		]);
		await runtime.emitSessionBranch();
		const branchedOn = await runtime.emitBeforeAgentStart(["base-system"]);
		expect(branchedOn?.systemPrompt).toBeDefined();
		expect(branchedOn!.systemPrompt!.at(-1)).toContain(POTETO_REMINDER);
		await runtime.invokeCommand("pstack-status");
		expect(runtime.notifications.at(-1)?.message).toContain("ON");

		// Tree navigation into an OFF leaf must clear sticky reminder leakage.
		runtime.replaceEntries([
			{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "OFF" } },
		]);
		await runtime.emitSessionTree();
		const treeOff = await runtime.emitBeforeAgentStart(["base-system"]);
		expect(treeOff?.systemPrompt ?? ["base-system"]).toEqual(["base-system"]);
		await runtime.invokeCommand("pstack-status");
		expect(runtime.notifications.at(-1)?.message).toContain("OFF");
	});

	test("active mode appends a short reminder without replacing prior system-prompt segments", async () => {
		loadExtension(runtime, { packageRoot, homeDir });
		await runtime.invokeCommand("poteto-mode", "keep going");

		const prior = ["segment-a", "segment-b"];
		const result = await runtime.emitBeforeAgentStart(prior, "next turn");

		expect(result?.systemPrompt).toBeDefined();
		expect(result!.systemPrompt![0]).toBe("segment-a");
		expect(result!.systemPrompt![1]).toBe("segment-b");
		expect(result!.systemPrompt!.length).toBe(prior.length + 1);
		const reminder = result!.systemPrompt![result!.systemPrompt!.length - 1]!;
		expect(reminder).toContain(POTETO_REMINDER);
		expect(reminder.length).toBeLessThan(POTETO_SKILL_BODY.length);
	});

	test("pstack-cleanup asks before deleting only the exact OMP model rule", async () => {
		const rulesDir = join(homeDir, ".omp", "agent", "rules");
		mkdirSync(rulesDir, { recursive: true });
		const modelRulePath = join(rulesDir, PSTACK_MODEL_RULE_BASENAME);
		const otherRulePath = join(rulesDir, "unrelated.md");
		writeFileSync(modelRulePath, "feature, refactoring: auto\n", "utf8");
		writeFileSync(otherRulePath, "keep me\n", "utf8");

		runtime.setConfirmResult(false);
		loadExtension(runtime, { packageRoot, homeDir });
		await runtime.invokeCommand("pstack-cleanup");

		expect(runtime.confirmCalls.length).toBe(1);
		expect(runtime.confirmCalls[0]!.message).toContain(PSTACK_MODEL_RULE_BASENAME);
		expect(readFileSync(modelRulePath, "utf8")).toContain("feature, refactoring");
		expect(readFileSync(otherRulePath, "utf8")).toBe("keep me\n");

		runtime.setConfirmResult(true);
		await runtime.invokeCommand("pstack-cleanup");

		expect(runtime.confirmCalls.length).toBe(2);
		expect(() => readFileSync(modelRulePath, "utf8")).toThrow();
		expect(readFileSync(otherRulePath, "utf8")).toBe("keep me\n");
	});
});

describe("pstack_task pure helpers", () => {
	test("expands panel versus slice strategies and refuses auto/inherit-parent as literal model slugs", () => {
		const panel = expandAssignments({
			strategy: "panel",
			prompt: "critique the diff",
			models: ["claude-a", "auto", "inherit-parent", "grok-b"],
		});
		expect(panel.map((item) => item.id)).toEqual(["panel-0", "panel-1", "panel-2", "panel-3"]);
		expect(panel[0]?.modelOverride).toBe("claude-a");
		expect(panel[3]?.modelOverride).toBe("grok-b");
		// Sentinels must never reach the runner as the strings "auto" / "inherit-parent".
		expect(panel[1]?.modelOverride).not.toBe("auto");
		expect(panel[2]?.modelOverride).not.toBe("inherit-parent");
		expect(resolveModelOverride("auto")).not.toBe("auto");
		expect(resolveModelOverride("inherit-parent")).not.toBe("inherit-parent");
		expect(resolveModelOverride("gpt-test")).toBe("gpt-test");

		const slices = expandAssignments({
			strategy: "slice",
			slices: [
				{ id: "auth", task: "cover auth" },
				{ id: "billing", task: "cover billing" },
			],
			model: "inherit-parent",
		});
		expect(slices.map((item) => item.id)).toEqual(["auth", "billing"]);
		expect(slices.every((item) => item.modelOverride !== "inherit-parent")).toBe(true);
	});

	test("executes expanded assignments concurrently through injected runSubprocess", async () => {
		let active = 0;
		let maxActive = 0;
		const started: string[] = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			started.push(options.id);
			active += 1;
			maxActive = Math.max(maxActive, active);
			await Bun.sleep(40);
			active -= 1;
			return {
				exitCode: 0,
				id: options.id,
				error: undefined,
			};
		};

		const assignments = expandAssignments({
			strategy: "panel",
			prompt: "parallel review",
			models: ["m1", "m2", "m3"],
		});

		const results = await executeAssignments(assignments, {
			runSubprocess,
			cwd: process.cwd(),
		});

		expect(started.sort()).toEqual(["panel-0", "panel-1", "panel-2"]);
		expect(maxActive).toBeGreaterThan(1);
		expect(results).toHaveLength(3);
		expect(results.every((result) => result.exitCode === 0)).toBe(true);
	});
});

describe("pstack_task tool seam", () => {
	function toolResultText(result: unknown): string {
		return messageText(result);
	}

	function resultDetails(result: unknown): Record<string, unknown> {
		if (!result || typeof result !== "object") return {};
		const details = (result as { details?: unknown }).details;
		return details && typeof details === "object" ? (details as Record<string, unknown>) : {};
	}

	test("registers pstack_task and routes execution through injected runSubprocess without live model calls", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-home-"));
		writePackageFixture(packageRoot);
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const calls: Array<Record<string, unknown>> = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			calls.push({
				id: options.id,
				task: options.task,
				modelOverride: options.modelOverride,
			});
			return { exitCode: 0, id: options.id, error: undefined, output: `ok-${options.id}` };
		};

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			expect(runtime.tools.has("pstack_task")).toBe(true);

			const tool = runtime.tools.get("pstack_task")!;
			const result = await tool.execute(
				"call-1",
				{
					strategy: "slice",
					slices: [
						{ id: "a", task: "slice-a" },
						{ id: "b", task: "slice-b" },
					],
					model: "m1",
				},
				undefined,
				undefined,
				runtime.createContext(),
			);

			expect(calls).toHaveLength(2);
			expect(calls.every((call) => call.task === "slice-a" || call.task === "slice-b")).toBe(true);
			expect(result).toBeDefined();
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("pstack_task content includes successful assignment output", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-out-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-out-home-"));
		writePackageFixture(packageRoot);
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const runSubprocess: RunSubprocessFn = async (options) => ({
			exitCode: 0,
			id: options.id,
			output: "SHIP: auth looks solid",
		});

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			const result = await tool.execute(
				"call-output",
				{ strategy: "panel", prompt: "review auth", models: ["m1"] },
				undefined,
				undefined,
				runtime.createContext(),
			);
			expect(toolResultText(result)).toContain("SHIP: auth looks solid");
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("auto and inherit-parent forward the execution context active parent model", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-model-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-model-home-"));
		writePackageFixture(packageRoot);
		const parentModel = { provider: "openai", id: "gpt-parent-live" };
		const runtime = createFakeRuntime({ cwd: packageRoot, parentModel });

		const calls: Array<Record<string, unknown>> = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			calls.push({ id: options.id, modelOverride: options.modelOverride });
			return { exitCode: 0, id: options.id, output: "ok" };
		};

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			await tool.execute(
				"call-inherit",
				{
					strategy: "panel",
					prompt: "inherit me",
					models: ["auto", "inherit-parent"],
				},
				undefined,
				undefined,
				runtime.createContext(),
			);
			expect(calls).toHaveLength(2);
			expect(calls.every((call) => call.modelOverride === "openai/gpt-parent-live")).toBe(true);
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("absent bundled agent definition does not reach the native runner as undefined", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-agent-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-agent-home-"));
		writePackageFixture(packageRoot);
		// Intentionally omit agents/poteto-agent.md from the fixture package.
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const calls: Array<Record<string, unknown>> = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			calls.push({
				id: options.id,
				hasAgentKey: Object.hasOwn(options, "agent"),
				agent: options.agent,
			});
			return { exitCode: 0, id: options.id, output: "ok" };
		};

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			const result = await tool.execute(
				"call-agent",
				{ strategy: "panel", prompt: "need agent", models: ["m1"] },
				undefined,
				undefined,
				runtime.createContext(),
			);

			if (calls.length === 0) {
				// Fail closed before launch is acceptable.
				expect(toolResultText(result).toLowerCase()).toMatch(/agent|missing|unavailable|required/);
			} else {
				for (const call of calls) {
					expect(call.agent).toBeDefined();
					expect(call.agent).not.toBeNull();
					const agent = call.agent as { systemPrompt?: unknown };
					expect(typeof agent.systemPrompt).toBe("string");
					expect(String(agent.systemPrompt).length).toBeGreaterThan(0);
				}
			}
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("repeated and concurrent logical ids get unique runtime ids while preserving logical ids in outputs", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-ids-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-ids-home-"));
		writePackageFixture(packageRoot);
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const calls: Array<Record<string, unknown>> = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			calls.push({ id: options.id, task: options.task });
			await Bun.sleep(15);
			// Native runner echoes its runtime registry id; tool details must still
			// remap results[].id back to the requested logical assignment id.
			return { exitCode: 0, id: options.id, output: `done:${options.task}` };
		};

		const expectLogicalResultIds = (
			result: unknown,
			expectedLogicalIds: string[],
			runtimeIdsForCall: string[],
		): void => {
			const details = resultDetails(result);
			const results = Array.isArray(details.results)
				? (details.results as Array<{ id?: string; runtimeId?: string }>)
				: [];
			expect(results).toHaveLength(expectedLogicalIds.length);
			for (const [index, logicalId] of expectedLogicalIds.entries()) {
				expect(results[index]?.id).toBe(logicalId);
				const runtimeId = results[index]?.runtimeId;
				if (runtimeId !== undefined) {
					expect(typeof runtimeId).toBe("string");
					expect(runtimeIdsForCall).toContain(runtimeId);
					expect(runtimeId).not.toBe(logicalId);
				}
			}
		};

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;

			const colliding = await tool.execute(
				"call-collide",
				{
					strategy: "slice",
					slices: [
						{ id: "Main", task: "first-main" },
						{ id: "Main", task: "second-main" },
					],
					model: "m1",
				},
				undefined,
				undefined,
				runtime.createContext(),
			);

			const [panelA, panelB] = await Promise.all([
				tool.execute(
					"call-panel-a",
					{ strategy: "panel", prompt: "panel-a", models: ["m1"] },
					undefined,
					undefined,
					runtime.createContext(),
				),
				tool.execute(
					"call-panel-b",
					{ strategy: "panel", prompt: "panel-b", models: ["m2"] },
					undefined,
					undefined,
					runtime.createContext(),
				),
			]);

			const runtimeIds = calls.map((call) => String(call.id));
			expect(runtimeIds).toHaveLength(4);
			expect(new Set(runtimeIds).size).toBe(4);
			// Unique native runtime IDs are observable only via injected runSubprocess.
			expect(runtimeIds.includes("Main")).toBe(false);
			expect(runtimeIds.filter((id) => id === "panel-0")).toHaveLength(0);

			const collidingText = toolResultText(colliding);
			expect(collidingText).toContain("Main");
			// Pin each returned details.results[i].id to the requested logical assignment id.
			expectLogicalResultIds(colliding, ["Main", "Main"], runtimeIds.slice(0, 2));
			expectLogicalResultIds(panelA, ["panel-0"], runtimeIds.slice(2, 3));
			expectLogicalResultIds(panelB, ["panel-0"], runtimeIds.slice(3, 4));
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("each native runner call receives a strict text outputSchema so yielded strings stay model-visible with exit 0", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-schema-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-schema-home-"));
		writePackageFixture(packageRoot);
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const yielded = "YIELD: panel consensus ready";
		const ompOmissionError =
			'OMP requires outputSchema: { type: "string" } (or equivalently strict non-null text schema) for yielded string results';

		const calls: Array<{ id: string; outputSchema: unknown }> = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			// Injected runSubprocess is the native-runner seam; OMP reads outputSchema here.
			const outputSchema = (options as { outputSchema?: unknown }).outputSchema;
			calls.push({ id: options.id, outputSchema });

			// Simulate the OMP failure boundary: omitting a strict text schema rejects
			// the yielded-string success path (non-zero exit, no model-visible yield).
			if (!isStrictTextOutputSchema(outputSchema)) {
				return {
					id: options.id,
					exitCode: 1,
					error: ompOmissionError,
				};
			}

			return {
				id: options.id,
				exitCode: 0,
				output: yielded,
			};
		};

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			const result = await tool.execute(
				"call-output-schema",
				{
					strategy: "panel",
					prompt: "return a short consensus string",
					models: ["m1", "m2"],
				},
				undefined,
				undefined,
				runtime.createContext(),
			);

			expect(calls).toHaveLength(2);
			for (const call of calls) {
				expect(isStrictTextOutputSchema(call.outputSchema)).toBe(true);
			}

			const text = toolResultText(result);
			expect(text).toContain(yielded);
			expect(text).toMatch(/exit 0/);
			expect(text).not.toContain(ompOmissionError);
			expect(text).not.toMatch(/exit 1/);
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
