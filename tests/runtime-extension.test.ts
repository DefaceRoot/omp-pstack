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
import {
	preservesChildMcpWithoutExtensionReload,
	preservesStandardNativeToolsWithoutRecursion,
	requiresTerminalYieldWithTextData,
} from "./helpers/runtime-agent-capabilities.ts";
import { createFakeRuntime, type FakeRuntime } from "./helpers/runtime-fake-api.ts";
import { MIN_OMP_CODING_AGENT_VERSION } from "./helpers/runtime-omp-version.ts";
import { isStrictOutputSchemaMode, isStrictTextOutputSchema } from "./helpers/runtime-output-schema.ts";
import { createFakeSettings } from "./helpers/runtime-settings.ts";

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

	// Final RED follow-ups after e38bc0d (this commit owns all three):
	// 1) getAgentDir profile fixture under join(homeDir,'profiles','work','agent') — no fixed /tmp path
	// 2) reject pi.pi.VERSION 17.2.13-beta.1 as < stable 17.2.13
	// 3) package peerDependenciesMeta optional (asserted in package-install.test.ts)
	test("extension initialization rejects pi.pi.VERSION below 17.2.13 with a clear minimum-version error", () => {
		// Semver prerelease of the exact floor is still < stable 17.2.13
		// (17.2.13-beta.1 must reject). Assert public init behavior only —
		// do not pin a suffix-stripping helper implementation.
		for (const version of ["17.2.12", "16.0.0", "17.2.12-beta.1", "17.2.13-beta.1", undefined] as const) {
			const isolated = createFakeRuntime({ cwd: packageRoot, version });
			expect(() => loadExtension(isolated, { packageRoot, homeDir })).toThrow(
				new RegExp(`minimum.*${MIN_OMP_CODING_AGENT_VERSION.replace(/\./g, "\\.")}|${MIN_OMP_CODING_AGENT_VERSION.replace(/\./g, "\\.")}.*minimum|VERSION.*${MIN_OMP_CODING_AGENT_VERSION.replace(/\./g, "\\.")}`, "i"),
			);
			expect(isolated.commands.size).toBe(0);
			expect(isolated.tools.size).toBe(0);
		}
	});

	test("extension initialization proceeds when pi.pi.VERSION is 17.2.13 or newer", () => {
		// Stable floor accepted; a prerelease of a higher triple (17.2.14-beta.1)
		// is semver-newer than 17.2.13 and may proceed.
		for (const version of ["17.2.13", "17.2.14", "18.0.0", "17.2.14-beta.1"] as const) {
			const isolated = createFakeRuntime({ cwd: packageRoot, version });
			expect(() => loadExtension(isolated, { packageRoot, homeDir })).not.toThrow();
			expect(isolated.commands.has("poteto-mode")).toBe(true);
			expect(isolated.tools.has("pstack_task")).toBe(true);
		}
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

	test("pstack-cleanup asks before deleting only the exact OMP model rule under active getAgentDir()", async () => {
		// Derive the active profile agent dir under this test's mkdtemp homeDir —
		// never a fixed global /tmp/profiles/... path, and never rmSync a path
		// outside the existing afterEach homeDir cleanup.
		const agentDir = join(homeDir, "profiles", "work", "agent");
		const rulesDir = join(agentDir, "rules");
		mkdirSync(rulesDir, { recursive: true });
		const modelRulePath = join(rulesDir, PSTACK_MODEL_RULE_BASENAME);
		const otherRulePath = join(rulesDir, "unrelated.md");
		const homeFallbackPath = join(homeDir, ".omp", "agent", "rules", PSTACK_MODEL_RULE_BASENAME);
		mkdirSync(join(homeDir, ".omp", "agent", "rules"), { recursive: true });
		writeFileSync(modelRulePath, "feature, refactoring: auto\n", "utf8");
		writeFileSync(otherRulePath, "keep me\n", "utf8");
		writeFileSync(homeFallbackPath, "do not touch home fallback\n", "utf8");

		runtime.setGetAgentDir(() => agentDir);
		runtime.setConfirmResult(false);
		loadExtension(runtime, { packageRoot, homeDir });
		await runtime.invokeCommand("pstack-cleanup");

		expect(runtime.confirmCalls.length).toBe(1);
		expect(runtime.confirmCalls[0]!.message).toContain(modelRulePath);
		expect(runtime.confirmCalls[0]!.message).toContain(PSTACK_MODEL_RULE_BASENAME);
		expect(runtime.confirmCalls[0]!.message).not.toContain(homeFallbackPath);
		expect(readFileSync(modelRulePath, "utf8")).toContain("feature, refactoring");
		expect(readFileSync(otherRulePath, "utf8")).toBe("keep me\n");
		expect(readFileSync(homeFallbackPath, "utf8")).toBe("do not touch home fallback\n");

		runtime.setConfirmResult(true);
		await runtime.invokeCommand("pstack-cleanup");

		expect(runtime.confirmCalls.length).toBe(2);
		expect(() => readFileSync(modelRulePath, "utf8")).toThrow();
		expect(readFileSync(otherRulePath, "utf8")).toBe("keep me\n");
		expect(readFileSync(homeFallbackPath, "utf8")).toBe("do not touch home fallback\n");
	});

	test("pstack-cleanup falls back to homeDir/.omp/agent when getAgentDir is unavailable", async () => {
		const rulesDir = join(homeDir, ".omp", "agent", "rules");
		mkdirSync(rulesDir, { recursive: true });
		const modelRulePath = join(rulesDir, PSTACK_MODEL_RULE_BASENAME);
		writeFileSync(modelRulePath, "feature, refactoring: auto\n", "utf8");

		// Explicitly omit getAgentDir so the extension must use the homeDir fallback.
		runtime.setGetAgentDir(undefined);
		runtime.setConfirmResult(true);
		loadExtension(runtime, { packageRoot, homeDir });
		await runtime.invokeCommand("pstack-cleanup");

		expect(runtime.confirmCalls.length).toBe(1);
		expect(runtime.confirmCalls[0]!.message).toContain(modelRulePath);
		expect(() => readFileSync(modelRulePath, "utf8")).toThrow();
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
			const text = toolResultText(result);
			expect(text).toContain("SHIP: auth looks solid");
			// Success stays concise: no failure-channel labels.
			expect(text).not.toMatch(/\berror:/i);
			expect(text).not.toMatch(/\bstderr:/i);
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("pstack_task content keeps partial output and labeled error/stderr on exit 1", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-fail-diag-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-fail-diag-home-"));
		writePackageFixture(packageRoot);
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const partialOutput = "PARTIAL: worker reached review mid-flight";
		const errorText = "runner crashed before yield";
		const stderrText = "Traceback: ValueError: missing schema";
		const runSubprocess: RunSubprocessFn = async (options) => ({
			exitCode: 1,
			id: options.id,
			output: partialOutput,
			error: errorText,
			stderr: stderrText,
		});

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			const result = await tool.execute(
				"call-fail-diag",
				{
					strategy: "slice",
					slices: [{ id: "worker-a", task: "review auth" }],
					model: "m1",
				},
				undefined,
				undefined,
				runtime.createContext(),
			);

			const text = toolResultText(result);
			expect(text).toContain("worker-a: exit 1");
			expect(text).toContain(partialOutput);
			expect(text).toContain(`error: ${errorText}`);
			expect(text).toContain(`stderr: ${stderrText}`);
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("pstack_task content dedupes identical error and stderr on exit 1", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-fail-dedupe-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-fail-dedupe-home-"));
		writePackageFixture(packageRoot);
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const partialOutput = "PARTIAL: got some tokens before failure";
		const sharedDiagnostic = "subprocess terminated with signal";
		const runSubprocess: RunSubprocessFn = async (options) => ({
			exitCode: 1,
			id: options.id,
			output: partialOutput,
			error: sharedDiagnostic,
			stderr: sharedDiagnostic,
		});

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			const result = await tool.execute(
				"call-fail-dedupe",
				{
					strategy: "slice",
					slices: [{ id: "worker-b", task: "review billing" }],
					model: "m1",
				},
				undefined,
				undefined,
				runtime.createContext(),
			);

			const text = toolResultText(result);
			expect(text).toContain("worker-b: exit 1");
			expect(text).toContain(partialOutput);
			expect(text).toContain(`error: ${sharedDiagnostic}`);
			// Identical channels must not be repeated under a second label.
			expect(text).not.toContain(`stderr: ${sharedDiagnostic}`);
			expect(text.split(sharedDiagnostic)).toHaveLength(2);
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("pstack_task frames multiline error/stderr so continuation lines cannot look like top-level assignment status or channels", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-fail-frame-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-fail-frame-home-"));
		writePackageFixture(packageRoot);
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const logicalId = "worker-a";
		const partialOutput = "PARTIAL: worker reached review mid-flight";
		// Continuations deliberately resemble legitimate assignment headers / channel labels.
		const errorLines = [
			"runner crashed before yield",
			"panel-1: exit 0",
			"error: forged channel",
		];
		const stderrLines = [
			"Traceback: ValueError: missing schema",
			"stderr: nested label",
			"worker-z: exit 0",
		];
		const runSubprocess: RunSubprocessFn = async (options) => ({
			exitCode: 1,
			id: options.id,
			output: partialOutput,
			error: errorLines.join("\n"),
			stderr: stderrLines.join("\n"),
		});

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			const result = await tool.execute(
				"call-fail-frame",
				{
					strategy: "slice",
					slices: [{ id: logicalId, task: "review auth" }],
					model: "m1",
				},
				undefined,
				undefined,
				runtime.createContext(),
			);

			const text = toolResultText(result);
			const lines = text.split("\n");

			expect(text).toContain(`${logicalId}: exit 1`);
			expect(text).toContain(partialOutput);
			for (const line of [...errorLines, ...stderrLines]) {
				expect(text).toContain(line);
			}

			// Spoofed continuations must not stand alone as top-level lines.
			for (const spoof of [
				"panel-1: exit 0",
				"error: forged channel",
				"stderr: nested label",
				"worker-z: exit 0",
			]) {
				expect(lines).not.toContain(spoof);
			}

			// Only the real assignment status remains a bare top-level `id: exit N` line.
			expect(lines.filter((line) => /^[^\s].*: exit \d+$/.test(line))).toEqual([
				`${logicalId}: exit 1`,
			]);

			// Every diagnostic line is visibly framed/prefixed inside the assignment block
			// (carrier line is not the bare diagnostic text at column 0).
			for (const diagnosticLine of [...errorLines, ...stderrLines]) {
				const carriers = lines.filter((line) => line.includes(diagnosticLine));
				expect(carriers.length).toBeGreaterThan(0);
				expect(carriers.every((line) => line !== diagnosticLine)).toBe(true);
			}
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
			'OMP 17.2.13 requires outputSchema:{type:"string"}, outputSchemaMode:"strict", enableMCP:true, and empty preloaded extension/custom-tool paths (restrictToolNames omitted)';

		const calls: Array<{
			id: string;
			outputSchema: unknown;
			outputSchemaMode: unknown;
			enableMCP: unknown;
			restrictToolNames: unknown;
			preloadedExtensionPaths: unknown;
			preloadedCustomToolPaths: unknown;
		}> = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			// Injected runSubprocess is the native-runner seam; OMP reads outputSchema here.
			const outputSchema = (options as { outputSchema?: unknown }).outputSchema;
			const outputSchemaMode = (options as { outputSchemaMode?: unknown }).outputSchemaMode;
			const enableMCP = (options as { enableMCP?: unknown }).enableMCP;
			const restrictToolNames = (options as { restrictToolNames?: unknown }).restrictToolNames;
			const preloadedExtensionPaths = (options as { preloadedExtensionPaths?: unknown }).preloadedExtensionPaths;
			const preloadedCustomToolPaths = (options as { preloadedCustomToolPaths?: unknown }).preloadedCustomToolPaths;
			calls.push({
				id: options.id,
				outputSchema,
				outputSchemaMode,
				enableMCP,
				restrictToolNames,
				preloadedExtensionPaths,
				preloadedCustomToolPaths,
			});

			// Simulate the OMP failure boundary: omitting strict schema/mode or MCP-preserving
			// preload policy rejects the yielded-string success path (non-zero exit).
			if (
				!isStrictTextOutputSchema(outputSchema) ||
				!isStrictOutputSchemaMode(outputSchemaMode) ||
				!preservesChildMcpWithoutExtensionReload({
					enableMCP,
					restrictToolNames,
					preloadedExtensionPaths,
					preloadedCustomToolPaths,
				})
			) {
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
				expect(isStrictOutputSchemaMode(call.outputSchemaMode)).toBe(true);
				expect(preservesChildMcpWithoutExtensionReload(call)).toBe(true);
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

	test("pstack_task respects live settings.get(task.maxConcurrency) with bounded concurrency and stable order", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-conc-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-conc-home-"));
		writePackageFixture(packageRoot);

		const settings = createFakeSettings({ "task.maxConcurrency": 2 });
		const runtime = createFakeRuntime({ cwd: packageRoot, settings });

		let active = 0;
		let maxActive = 0;
		const started: string[] = [];
		const completed: string[] = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			started.push(options.id);
			active += 1;
			maxActive = Math.max(maxActive, active);
			await Bun.sleep(40);
			active -= 1;
			completed.push(options.id);
			return { exitCode: 0, id: options.id, output: `done:${options.task}` };
		};

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			const result = await tool.execute(
				"call-concurrency",
				{
					strategy: "slice",
					slices: [
						{ id: "s1", task: "one" },
						{ id: "s2", task: "two" },
						{ id: "s3", task: "three" },
						{ id: "s4", task: "four" },
						{ id: "s5", task: "five" },
					],
					model: "m1",
				},
				undefined,
				undefined,
				runtime.createContext(),
			);

			// Positive N must bound concurrent native runner calls.
			expect(maxActive).toBe(2);
			expect(started).toHaveLength(5);
			expect(completed).toHaveLength(5);

			const details = resultDetails(result);
			const results = Array.isArray(details.results)
				? (details.results as Array<{ id?: string; exitCode?: number }>)
				: [];
			expect(results.map((item) => item.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
			expect(results.every((item) => item.exitCode === 0)).toBe(true);
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("two concurrent pstack_task executions share one extension-scoped live maxConcurrency limiter", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-shared-conc-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-shared-conc-home-"));
		writePackageFixture(packageRoot);

		const settings = createFakeSettings({ "task.maxConcurrency": 2 });
		const runtime = createFakeRuntime({ cwd: packageRoot, settings });

		let active = 0;
		let maxActive = 0;
		const runSubprocess: RunSubprocessFn = async (options) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await Bun.sleep(50);
			active -= 1;
			return { exitCode: 0, id: options.id, output: `done:${options.task}` };
		};

		try {
			// One extension registration => one session/extension-scoped limiter.
			// A limiter instantiated inside executeAssignments per call would allow
			// maxActive up to 4 (2+2) under concurrent tool.execute.
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;

			const [first, second] = await Promise.all([
				tool.execute(
					"call-shared-a",
					{
						strategy: "slice",
						slices: [
							{ id: "a1", task: "a-one" },
							{ id: "a2", task: "a-two" },
							{ id: "a3", task: "a-three" },
						],
						model: "m1",
					},
					undefined,
					undefined,
					runtime.createContext(),
				),
				tool.execute(
					"call-shared-b",
					{
						strategy: "slice",
						slices: [
							{ id: "b1", task: "b-one" },
							{ id: "b2", task: "b-two" },
							{ id: "b3", task: "b-three" },
						],
						model: "m1",
					},
					undefined,
					undefined,
					runtime.createContext(),
				),
			]);

			expect(maxActive).toBe(2);
			expect(resultDetails(first).results).toHaveLength(3);
			expect(resultDetails(second).results).toHaveLength(3);

			// Live decrease: subsequent wave must observe settings.get updates.
			settings.set("task.maxConcurrency", 1);
			maxActive = 0;
			await tool.execute(
				"call-shared-dec",
				{
					strategy: "slice",
					slices: [
						{ id: "d1", task: "dec-one" },
						{ id: "d2", task: "dec-two" },
						{ id: "d3", task: "dec-three" },
					],
					model: "m1",
				},
				undefined,
				undefined,
				runtime.createContext(),
			);
			expect(maxActive).toBe(1);

			// Live increase.
			settings.set("task.maxConcurrency", 3);
			maxActive = 0;
			await tool.execute(
				"call-shared-inc",
				{
					strategy: "slice",
					slices: [
						{ id: "i1", task: "inc-one" },
						{ id: "i2", task: "inc-two" },
						{ id: "i3", task: "inc-three" },
						{ id: "i4", task: "inc-four" },
					],
					model: "m1",
				},
				undefined,
				undefined,
				runtime.createContext(),
			);
			expect(maxActive).toBe(3);
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("poteto AgentDefinition systemPrompt requires terminal yield with non-null result.data text", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-yield-prompt-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-yield-prompt-home-"));
		writePackageFixture(packageRoot);
		mkdirSync(join(packageRoot, "agents"), { recursive: true });
		writeFileSync(
			join(packageRoot, "agents", "poteto-agent.md"),
			[
				"---",
				"name: poteto-agent",
				"description: poteto worker",
				"---",
				"",
				"# Poteto subagent",
				"",
				"Complete the assigned task thoroughly and return the result.",
			].join("\n"),
			"utf8",
		);
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const prompts: string[] = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			const agent = options.agent as { systemPrompt?: unknown } | undefined;
			prompts.push(String(agent?.systemPrompt ?? ""));
			return { exitCode: 0, id: options.id, output: "ok" };
		};

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			await tool.execute(
				"call-yield-prompt",
				{ strategy: "panel", prompt: "finish with yield text", models: ["m1"] },
				undefined,
				undefined,
				runtime.createContext(),
			);

			expect(prompts).toHaveLength(1);
			expect(requiresTerminalYieldWithTextData(prompts[0])).toBe(true);
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("every AgentDefinition passed to raw runSubprocess omits tools and spawns with MCP preloads and strict yield", async () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "omp-pstack-tool-caps-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omp-pstack-tool-caps-home-"));
		writePackageFixture(packageRoot);
		const runtime = createFakeRuntime({ cwd: packageRoot });

		const agents: Array<Record<string, unknown>> = [];
		const runSubprocess: RunSubprocessFn = async (options) => {
			const agent = options.agent as Record<string, unknown> | undefined;
			// Public ExecutorOptions: preserve MCP, block extension reload via empty preloads.
			agents.push({
				agent,
				enableMCP: (options as { enableMCP?: unknown }).enableMCP,
				restrictToolNames: (options as { restrictToolNames?: unknown }).restrictToolNames,
				preloadedExtensionPaths: (options as { preloadedExtensionPaths?: unknown }).preloadedExtensionPaths,
				preloadedCustomToolPaths: (options as { preloadedCustomToolPaths?: unknown }).preloadedCustomToolPaths,
				outputSchema: (options as { outputSchema?: unknown }).outputSchema,
				outputSchemaMode: (options as { outputSchemaMode?: unknown }).outputSchemaMode,
				taskDepth: (options as { taskDepth?: unknown }).taskDepth,
			});
			return { exitCode: 0, id: options.id, output: "ok" };
		};

		try {
			loadExtension(runtime, { packageRoot, homeDir, runSubprocess });
			const tool = runtime.tools.get("pstack_task")!;
			await tool.execute(
				"call-agent-caps",
				{
					strategy: "panel",
					prompt: "stay non-recursive",
					models: ["m1", "m2"],
				},
				undefined,
				undefined,
				runtime.createContext(),
			);

			expect(agents).toHaveLength(2);
			for (const entry of agents) {
				const agent = entry.agent as {
					tools?: unknown;
					spawns?: unknown;
					systemPrompt?: unknown;
				} | undefined;
				// OMP 17.2.13: omit agent.tools so standard built-ins remain available.
				// Also omit agent.spawns — spawns:[] is still defined and auto-adds task
				// when a tools whitelist is present; undefined keeps empty spawnsEnv
				// without activating recursive task.
				expect(preservesStandardNativeToolsWithoutRecursion(agent)).toBe(true);
				expect(Object.hasOwn(agent ?? {}, "tools")).toBe(false);
				expect(Object.hasOwn(agent ?? {}, "spawns")).toBe(false);
				expect(agent?.tools).toBeUndefined();
				expect(agent?.spawns).toBeUndefined();
				expect(requiresTerminalYieldWithTextData(agent?.systemPrompt)).toBe(true);
				expect(preservesChildMcpWithoutExtensionReload(entry)).toBe(true);
				expect(isStrictTextOutputSchema(entry.outputSchema)).toBe(true);
				expect(isStrictOutputSchemaMode(entry.outputSchemaMode)).toBe(true);
			}
		} finally {
			rmSync(packageRoot, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
