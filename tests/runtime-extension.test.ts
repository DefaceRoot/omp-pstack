import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BUNDLED_TEAM_KIT_COMMANDS,
	OTHER_PSTACK_DIRECT_SKILL_COMMANDS,
	PSTACK_DIRECT_SKILL_COMMANDS,
	PSTACK_MODE_ENTRY_TYPE,
	LEGACY_MODEL_RULE_BASENAME,
	PSTACK_SESSION_COMMANDS,
} from "./helpers/runtime-expected-commands.ts";
import { createFakeRuntime, type FakeRuntime } from "./helpers/runtime-fake-api.ts";
import { MIN_OMP_CODING_AGENT_VERSION } from "./helpers/runtime-omp-version.ts";
import { createFakeSettings } from "./helpers/runtime-settings.ts";

import pstackExtension, {
	createPstackExtension,
	type PstackExtensionOptions,
} from "../src/extension.ts";

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
	const agents = join(import.meta.dir, "..", "agents");
	mkdirSync(join(root, "agents"));
	for (const file of readdirSync(agents)) {
		if (file.endsWith(".md")) copyFileSync(join(agents, file), join(root, "agents", file));
	}
}

function loadExtension(
	runtime: FakeRuntime,
	options: PstackExtensionOptions = {},
): void {
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


	const POTETO_STATUS_KEY = "poteto-mode";

	function expectPotetoStatus(runtime: FakeRuntime, expected: string | undefined): void {
		if (expected === undefined) {
			expect(runtime.statuses.has(POTETO_STATUS_KEY)).toBe(false);
		} else {
			expect(runtime.statuses.get(POTETO_STATUS_KEY)).toBe(expected);
		}
	}

	test("extension initialization rejects hosts below 18.2.11", () => {
		for (const version of ["18.2.10", "17.2.13", "18.2.11-beta.1", undefined] as const) {
			const isolated = createFakeRuntime({ cwd: packageRoot, version });
			expect(() => loadExtension(isolated, { packageRoot, homeDir })).toThrow(
				new RegExp(`minimum.*${MIN_OMP_CODING_AGENT_VERSION.replace(/\./g, "\\.")}|${MIN_OMP_CODING_AGENT_VERSION.replace(/\./g, "\\.")}.*minimum|VERSION.*${MIN_OMP_CODING_AGENT_VERSION.replace(/\./g, "\\.")}`, "i"),
			);
			expect(isolated.commands.size).toBe(0);
			expect(isolated.tools.size).toBe(0);
		}
	});

	test("extension initialization proceeds on 18.2.11 or newer", () => {
		for (const version of ["18.2.11", "18.2.12", "19.0.0", "18.2.12-beta.1"] as const) {
			const isolated = createFakeRuntime({ cwd: packageRoot, version });
			expect(() => loadExtension(isolated, { packageRoot, homeDir })).not.toThrow();
			expect(isolated.commands.has("poteto-mode")).toBe(true);
			expect(isolated.tools.size).toBe(0);
		}
	});

	test("registers poteto-mode, the other 21 P-Stack direct skills, bundled team-kit skills, and session commands unprefixed", () => {
		loadExtension(runtime, { packageRoot, homeDir });

		expect(PSTACK_DIRECT_SKILL_COMMANDS).toHaveLength(22);
		expect(OTHER_PSTACK_DIRECT_SKILL_COMMANDS).toHaveLength(21);
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

	test("registers no custom task tool", () => {
		loadExtension(runtime, { packageRoot, homeDir });
		expect(runtime.tools.size).toBe(0);
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
		expect(runtime.notifications.at(-1)?.message).toBe("P-Stack mode is OFF.\nUse /setup-pstack to see agent model assignments.");

		// Branch into a session whose latest sticky entry is ON.
		runtime.replaceEntries([
			{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "ON" } },
		]);
		await runtime.emitSessionBranch();
		const branchedOn = await runtime.emitBeforeAgentStart(["base-system"]);
		expect(branchedOn?.systemPrompt).toBeDefined();
		expect(branchedOn!.systemPrompt!.at(-1)).toContain(POTETO_REMINDER);
		await runtime.invokeCommand("pstack-status");
		expect(runtime.notifications.at(-1)?.message).toBe("P-Stack mode is ON.\nUse /setup-pstack to see agent model assignments.");

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

	test("cleanup removes only P-Stack overrides and disabled entries after confirmation", async () => {
		const agentDir = join(homeDir, "profiles", "work", "agent");
		const rulesDir = join(agentDir, "rules");
		mkdirSync(rulesDir, { recursive: true });
		const legacyRulePath = join(rulesDir, LEGACY_MODEL_RULE_BASENAME);
		const otherRulePath = join(rulesDir, "unrelated.md");
		writeFileSync(legacyRulePath, "legacy rule\n");
		writeFileSync(otherRulePath, "keep me\n");
		const settings = createFakeSettings({
			"task.agentModelOverrides": {
				"poteto-agent": "openai/gpt-x",
				"pstack-cross-judge": ["anthropic/opus:high", "openai/gpt-y"],
				"pstack-feature": "zai/glm-flash",
				scout: "zai/glm-flash",
				"comment-sicko": "openai/gpt-z",
			},
			"task.disabledAgents": ["pstack-feature", "poteto-agent", "scout", "comment-sicko"],
		});
		runtime.setSettings(settings);
		runtime.setGetAgentDir(() => agentDir);
		runtime.setConfirmResult(false);
		loadExtension(runtime, { packageRoot, homeDir });

		await runtime.invokeCommand("pstack-cleanup");
		expect(runtime.confirmCalls[0]!.message).toContain(legacyRulePath);
		expect(runtime.confirmCalls[0]!.message).toContain("disabled entries");
		expect(settings.values["task.disabledAgents"]).toEqual(["pstack-feature", "poteto-agent", "scout", "comment-sicko"]);
		expect(existsSync(legacyRulePath)).toBe(true);

		runtime.setConfirmResult(true);
		await runtime.invokeCommand("pstack-cleanup");
		expect(settings.values["task.agentModelOverrides"]).toEqual({
			scout: "zai/glm-flash",
			"comment-sicko": "openai/gpt-z",
		});
		expect(settings.values["task.disabledAgents"]).toEqual(["scout", "comment-sicko"]);
		expect(existsSync(legacyRulePath)).toBe(false);
		expect(readFileSync(otherRulePath, "utf8")).toBe("keep me\n");
	});

	test("pstack-cleanup falls back to homeDir/.omp/agent for the legacy rule when getAgentDir is unavailable", async () => {
		const rulesDir = join(homeDir, ".omp", "agent", "rules");
		mkdirSync(rulesDir, { recursive: true });
		const legacyRulePath = join(rulesDir, LEGACY_MODEL_RULE_BASENAME);
		writeFileSync(legacyRulePath, "feature, refactoring: auto\n", "utf8");

		runtime.setGetAgentDir(undefined);
		loadExtension(runtime, { packageRoot, homeDir });
		await runtime.invokeCommand("pstack-cleanup");

		expect(runtime.confirmCalls[0]!.message).toContain(legacyRulePath);
		expect(existsSync(legacyRulePath)).toBe(false);
	});

	test("setup lists every shipped P-Stack agent with defaults, overrides, and disabled status", async () => {
		const agentDir = join(homeDir, "agent");
		mkdirSync(join(agentDir, "rules"), { recursive: true });
		const legacyRulePath = join(agentDir, "rules", LEGACY_MODEL_RULE_BASENAME);
		writeFileSync(legacyRulePath, "legacy rule\n");
		runtime.setGetAgentDir(() => agentDir);
		runtime.setSettings(createFakeSettings({
			"task.agentModelOverrides": {
				"pstack-feature": "openai/gpt-y:high",
				"pstack-cross-judge": ["anthropic/opus:high", "openai/gpt-y:low"],
			},
			"task.disabledAgents": ["pstack-bug-fix", "scout"],
		}));
		loadExtension(runtime, { packageRoot, homeDir });

		await runtime.invokeCommand("setup-pstack");

		expect(existsSync(legacyRulePath)).toBe(false);
		const summary = runtime.notifications.map((note) => note.message).join("\n");
		expect(summary).toContain("pstack-feature: openai/gpt-y:high");
		expect(summary).toContain("pstack-bug-fix: @task (disabled)");
		expect(summary).toContain("pstack-cross-judge: anthropic/opus:high, openai/gpt-y:low");
		expect(summary).toContain("poteto-agent: @task");
		expect(summary).toContain("Blind cross-family judge");
		expect(summary).toContain("Set each agent's model and thinking level in /agents. Defaults follow OMP's built-in roles (@task, @slow, @default).");
		const names = readdirSync(join(packageRoot, "agents"))
			.map((file) => file.replace(/\.md$/, ""))
			.filter((name) => name === "poteto-agent" || name.startsWith("pstack-"));
		for (const name of names) expect(summary).toContain(`${name}: `);
		expect(summary).not.toContain("comment-sicko:");
		expect(runtime.getEditorText()).toBe("/create-verification-skill ");
	});

	test("setup-pstack skips the legacy and verification prompts when neither applies", async () => {
		mkdirSync(join(packageRoot, ".omp", "skills", "verify-app"), { recursive: true });
		runtime.setGetAgentDir(() => join(homeDir, "agent"));
		loadExtension(runtime, { packageRoot, homeDir });

		await runtime.invokeCommand("setup-pstack");

		expect(runtime.confirmCalls).toEqual([]);
		expect(runtime.getEditorText()).toBe("");
	});


	test("cross-judge prefers the first different model family while preserving fallback order", async () => {
		const session = { provider: "zai", id: "glm-flash" };
		const availableModels = [
			session,
			{ provider: "zai", id: "glm-pro" },
			{ provider: "openai", id: "gpt-x" },
			{ provider: "anthropic", id: "opus" },
		];
		const isolated = createFakeRuntime({ cwd: packageRoot, parentModel: session, availableModels });
		loadExtension(isolated, { packageRoot, homeDir });
		const handler = isolated.handlers.get("before_subagent_spawn")?.[0];
		expect(handler).toBeDefined();
		const ctx = isolated.createContext();
		const patterns = ["zai/glm-pro:high", "missing/model", "openai/gpt-x:high", "anthropic/opus:low"];
		expect(await handler!({ agent: "pstack-cross-judge", patterns }, ctx)).toEqual({
			model: ["openai/gpt-x:high", "zai/glm-pro:high", "missing/model", "anthropic/opus:low"],
			note: "pstack-cross-judge: preferring openai/gpt-x:high from a different family than the session",
		});
		expect(patterns).toEqual(["zai/glm-pro:high", "missing/model", "openai/gpt-x:high", "anthropic/opus:low"]);
		const currentOnly = isolated.createContext();
		currentOnly.model = undefined;
		expect(await handler!({ agent: "pstack-cross-judge", patterns }, currentOnly)).toEqual({
			model: ["openai/gpt-x:high", "zai/glm-pro:high", "missing/model", "anthropic/opus:low"],
			note: "pstack-cross-judge: preferring openai/gpt-x:high from a different family than the session",
		});
		expect(await handler!({ agent: "pstack-cross-judge", patterns: ["anthropic/opus:low", "zai/glm-pro"] }, ctx)).toBeUndefined();
		expect(await handler!({ agent: "pstack-cross-judge", patterns: ["zai/glm-pro", "missing/model"] }, ctx)).toBeUndefined();
		expect(await handler!({ agent: "pstack-feature", patterns }, ctx)).toBeUndefined();
		isolated.setParentModel(undefined);
		expect(await handler!({ agent: "pstack-cross-judge", patterns }, isolated.createContext())).toBeUndefined();
	});

	test("registers ctrl+alt+o and only rewrites the visible editor draft", async () => {
		loadExtension(runtime, { packageRoot, homeDir });

		expect(runtime.shortcuts.has("ctrl+alt+o")).toBe(true);
		expect(runtime.shortcuts.has("ctrl+alt+p")).toBe(false);

		runtime.setEditorText("");
		await runtime.invokeShortcut("ctrl+alt+o");
		expect(runtime.getEditorText()).toBe("/poteto-mode ");
		expect(runtime.sentMessages).toEqual([]);
		expect(latestModeEntry(runtime)).toBeUndefined();
		expectPotetoStatus(runtime, undefined);

		runtime.setEditorText("ship the watcher");
		await runtime.invokeShortcut("ctrl+alt+o");
		expect(runtime.getEditorText()).toBe("/poteto-mode ship the watcher");
		expect(runtime.sentMessages).toEqual([]);
		expect(latestModeEntry(runtime)).toBeUndefined();
		expectPotetoStatus(runtime, undefined);

		runtime.setEditorText("/poteto-mode");
		await runtime.invokeShortcut("ctrl+alt+o");
		expect(runtime.getEditorText()).toBe("/poteto-mode");

		runtime.setEditorText("/poteto-mode already armed");
		await runtime.invokeShortcut("ctrl+alt+o");
		expect(runtime.getEditorText()).toBe("/poteto-mode already armed");

		runtime.setEditorText("/poteto-mode ");
		await runtime.invokeShortcut("ctrl+alt+o");
		expect(runtime.getEditorText()).toBe("/poteto-mode ");

		expect(runtime.sentMessages).toEqual([]);
		expect(runtime.entries.filter((e) => e.customType === PSTACK_MODE_ENTRY_TYPE)).toEqual([]);
		expectPotetoStatus(runtime, undefined);

		const afterShortcut = await runtime.emitBeforeAgentStart(["base-system"]);
		expect(afterShortcut?.systemPrompt ?? ["base-system"]).toEqual(["base-system"]);
	});

	test("/poteto-mode projects preset-aware poteto-mode status and /pstack-off clears it", async () => {
		loadExtension(runtime, { packageRoot, homeDir });

		await runtime.invokeCommand("poteto-mode", "focus");
		expect(latestModeEntry(runtime)).toEqual({ state: "ON" });
		expectPotetoStatus(runtime, "🥔 poteto");

		await runtime.invokeCommand("pstack-off");
		expect(latestModeEntry(runtime)).toEqual({ state: "OFF" });
		expectPotetoStatus(runtime, undefined);

		runtime.setSymbolPreset("nerd");
		await runtime.invokeCommand("poteto-mode", "again");
		expectPotetoStatus(runtime, "🥔 poteto");
		await runtime.invokeCommand("pstack-off");
		expectPotetoStatus(runtime, undefined);

		runtime.setSymbolPreset("ascii");
		await runtime.invokeCommand("poteto-mode", "ascii path");
		expectPotetoStatus(runtime, "[P] poteto");
		await runtime.invokeCommand("pstack-off");
		expectPotetoStatus(runtime, undefined);
	});

	test("session_start and session_switch reconstruct poteto-mode status from latest ON/OFF", async () => {
		const onRuntime = createFakeRuntime({
			cwd: packageRoot,
			initialEntries: [
				{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "OFF" } },
				{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "ON" } },
			],
		});
		loadExtension(onRuntime, { packageRoot, homeDir });
		expectPotetoStatus(onRuntime, undefined);

		await onRuntime.emitSessionStart();
		expectPotetoStatus(onRuntime, "🥔 poteto");

		onRuntime.setSymbolPreset("ascii");
		onRuntime.replaceEntries([
			{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "ON" } },
			{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "OFF" } },
		]);
		await onRuntime.emitSessionSwitch("resume");
		expectPotetoStatus(onRuntime, undefined);

		onRuntime.replaceEntries([
			{ type: "custom", customType: PSTACK_MODE_ENTRY_TYPE, data: { state: "ON" } },
		]);
		await onRuntime.emitSessionSwitch("fork");
		expectPotetoStatus(onRuntime, "[P] poteto");
	});

});



