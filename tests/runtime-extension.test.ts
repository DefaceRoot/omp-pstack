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

// Public seams under test (absent until the green implementation lands).
import pstackExtension, {
	createPstackExtension,
	type PstackExtensionOptions,
} from "../src/extension.ts";
import {
	executeAssignments,
	expandAssignments,
	resolveModelOverride,
	type Assignment,
	type RunSubprocessFn,
} from "../src/pstack-task.ts";

const POTETO_SKILL_BODY = `# Poteto mode

## Non-negotiables

Start every multi-step task with a todolist.
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

	test("registers poteto-mode, all other P-Stack direct skills, bundled team-kit skills, and session commands unprefixed", () => {
		loadExtension(runtime, { packageRoot, homeDir });

		expect(runtime.commands.has("poteto-mode")).toBe(true);
		expect(OTHER_PSTACK_DIRECT_SKILL_COMMANDS.length).toBeGreaterThan(0);
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
	test("expands panel versus slice strategies and maps auto/inherit-parent to parent inheritance", () => {
		const panel = expandAssignments({
			strategy: "panel",
			prompt: "critique the diff",
			models: ["claude-a", "auto", "inherit-parent", "grok-b"],
		});
		expect(panel).toEqual([
			{ id: "panel-0", task: "critique the diff", modelOverride: "claude-a" },
			{ id: "panel-1", task: "critique the diff", modelOverride: undefined },
			{ id: "panel-2", task: "critique the diff", modelOverride: undefined },
			{ id: "panel-3", task: "critique the diff", modelOverride: "grok-b" },
		] satisfies Assignment[]);

		const slices = expandAssignments({
			strategy: "slice",
			slices: [
				{ id: "auth", task: "cover auth" },
				{ id: "billing", task: "cover billing" },
			],
			model: "inherit-parent",
		});
		expect(slices).toEqual([
			{ id: "auth", task: "cover auth", modelOverride: undefined },
			{ id: "billing", task: "cover billing", modelOverride: undefined },
		]);

		expect(resolveModelOverride("auto")).toBeUndefined();
		expect(resolveModelOverride("inherit-parent")).toBeUndefined();
		expect(resolveModelOverride("gpt-test")).toBe("gpt-test");
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
			return { exitCode: 0, id: options.id, error: undefined };
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
					model: "auto",
				},
				undefined,
				undefined,
				runtime.createContext(),
			);

			expect(calls).toHaveLength(2);
			expect(calls.every((call) => call.modelOverride === undefined)).toBe(true);
			expect(calls.map((call) => call.id).sort()).toEqual(["a", "b"]);
			expect(result).toBeDefined();
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
