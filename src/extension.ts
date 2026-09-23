import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIRECT_SKILLS = [
	"architect",
	"arena",
	"automate-me",
	"blast-radius",
	"bro",
	"create-verification-skill",
	"figure-it-out",
	"how",
	"interrogate",
	"maintain-verification-skill",
	"no-comments",
	"poteto-mode",
	"recall",
	"reflect",
	"show-me-your-work",
	"swarm",
	"tdd",
	"teach",
	"technical-writing",
	"typescript-best-practices",
	"unslop",
	"why",
] as const;

const TEAM_KIT_SKILLS = ["deslop", "control-cli", "control-ui"] as const;
const MODE_ENTRY_TYPE = "pstack-mode";
const POTETO_COMMAND = "/poteto-mode";
const POTETO_STATUS_KEY = "poteto-mode";
const LEGACY_MODEL_RULE_BASENAME = "pstack-models.md";
const DEFAULT_REMINDER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

export type ReadTextFileFn = (path: string) => string | Promise<string>;
export type RemoveFileFn = (path: string) => void | Promise<void>;

export type PstackExtensionOptions = {
	packageRoot?: string;
	homeDir?: string;
	readFile?: ReadTextFileFn;
	removeFile?: RemoveFileFn;
	filesystem?: {
		readFile?: ReadTextFileFn;
		removeFile?: RemoveFileFn;
	};
};

type ActiveModel = { provider: string; id: string };
type SettingsValues = {
	"task.agentModelOverrides": Record<string, string | string[]>;
	"task.disabledAgents": string[];
};
type SettingsApi = {
	get?: <K extends keyof SettingsValues>(key: K) => SettingsValues[K] | undefined;
	set?: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;
};
type SymbolPreset = "unicode" | "nerd" | "ascii";
type CommandContext = {
	cwd: string;
	ui: {
		notify?: (message: string, level?: string) => void;
		confirm: (title: string, message: string) => Promise<boolean>;
		setStatus: (key: string, text: string | undefined) => void;
		setEditorText: (text: string) => void;
		getEditorText: () => string;
		theme: { getSymbolPreset: () => SymbolPreset };
	};
	sessionManager: {
		getBranch?: () => unknown[];
		getEntries?: () => unknown[];
	};
	model?: ActiveModel;
	models?: {
		current: () => ActiveModel | undefined;
		resolve: (spec: string) => ActiveModel | undefined;
		family: (model: ActiveModel) => string;
	};
};
type ExtensionApi = {
	registerCommand: (
		name: string,
		options: { description?: string; handler: (args: string, ctx: CommandContext) => void | Promise<void> },
	) => void;
	registerShortcut: (
		shortcut: string,
		options: { description?: string; handler: (ctx: CommandContext) => void | Promise<void> },
	) => void;
	on(event: "before_subagent_spawn", handler: (event: SubagentSpawnEvent, ctx: CommandContext) => unknown): void;
	on(event: "before_agent_start", handler: (event: { systemPrompt?: string | string[] }, ctx: CommandContext) => unknown): void;
	on(event: string, handler: (event: unknown, ctx: CommandContext) => unknown): void;
	appendEntry: (customType: string, data?: unknown) => void;
	sendUserMessage?: (content: unknown, options?: unknown) => void;
	sendMessage?: (message: unknown, options?: unknown) => void;
	pi?: {
		settings?: SettingsApi;
		getAgentDir?: () => string;
		VERSION?: string;
	};
};
type SubagentSpawnEvent = { agent: string; patterns: string[] };
type SkillDocument = { body: string; metadata: Record<string, string> };
type AgentDefinition = { name: string; description: string; model: string | string[] };

function parseSkillDocument(source: string): SkillDocument {
	if (!source.startsWith("---")) return { body: source, metadata: {} };
	const firstLineEnd = source.indexOf("\n");
	const closing = source.indexOf("\n---", firstLineEnd + 1);
	if (firstLineEnd < 0 || closing < 0) return { body: source, metadata: {} };

	const metadata: Record<string, string> = {};
	for (const line of source.slice(firstLineEnd + 1, closing).split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
	}
	const bodyStart = source.indexOf("\n", closing + 1);
	return { body: bodyStart < 0 ? "" : source.slice(bodyStart + 1).replace(/^\r?\n/, ""), metadata };
}

function parseFrontmatterValue(value: string): unknown {
	if (value.startsWith('"') || value.startsWith("[")) return JSON.parse(value);
	return value;
}

function parseAgentDefinition(metadata: Record<string, string>): AgentDefinition {
	const name = metadata.name;
	const description = metadata.description === undefined ? undefined : parseFrontmatterValue(metadata.description);
	const model = metadata.model === undefined ? undefined : parseFrontmatterValue(metadata.model);
	if (
		!name || typeof description !== "string" ||
		!(typeof model === "string" || (Array.isArray(model) && model.every((entry) => typeof entry === "string")))
	) {
		throw new Error(`Invalid P-Stack agent frontmatter for ${name ?? "unnamed agent"}`);
	}
	return { name, description, model };
}

function latestModeState(entries: readonly unknown[]): boolean {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry || typeof entry !== "object") continue;
		if (!("type" in entry) || entry.type !== "custom") continue;
		if (!("customType" in entry) || entry.customType !== MODE_ENTRY_TYPE) continue;
		if (!("data" in entry) || !entry.data || typeof entry.data !== "object") return false;
		return "state" in entry.data && entry.data.state === "ON";
	}
	return false;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function hasVerificationSkill(cwd: string): boolean {
	try {
		return readdirSync(join(cwd, ".omp", "skills")).some((name) => name.startsWith("verify-"));
	} catch {
		return false;
	}
}

const DEFAULT_PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIN_OMP_VERSION = [18, 2, 11] as const;
const MIN_OMP_VERSION_TEXT = MIN_OMP_VERSION.join(".");
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function supportedOmpVersion(version: unknown): boolean {
	if (typeof version !== "string") return false;
	const match = SEMVER_PATTERN.exec(version);
	if (!match) return false;
	const prerelease = match[4];
	if (
		prerelease
		&& prerelease.split(".").some(
			(identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"),
		)
	) {
		return false;
	}

	const actual = [Number(match[1]), Number(match[2]), Number(match[3])];
	for (let index = 0; index < MIN_OMP_VERSION.length; index += 1) {
		if (actual[index]! > MIN_OMP_VERSION[index]!) return true;
		if (actual[index]! < MIN_OMP_VERSION[index]!) return false;
	}
	return prerelease === undefined;
}

function assertSupportedOmpVersion(version: unknown): void {
	if (supportedOmpVersion(version)) return;
	const received = typeof version === "string" ? JSON.stringify(version) : "missing VERSION";
	throw new Error(
		`omp-pstack requires OMP >=${MIN_OMP_VERSION_TEXT}; minimum pi.pi.VERSION is ${MIN_OMP_VERSION_TEXT} (received ${received}).`,
	);
}

type ResponsesItem = { type?: unknown; role?: unknown; [key: string]: unknown };

function normalizeResponsesToolTurns(payload: unknown): unknown {
	if (!payload || typeof payload !== "object" || !("input" in payload) || !Array.isArray(payload.input)) return undefined;
	const items = payload.input as ResponsesItem[];
	const result: ResponsesItem[] = [];
	let index = 0;
	while (index < items.length) {
		const first = items[index]!;
		if (first.type !== "function_call") {
			result.push(first);
			index += 1;
			continue;
		}
		const hoisted: ResponsesItem[] = [];
		const calls: ResponsesItem[] = [];
		while (index < items.length) {
			const item = items[index]!;
			if (item.type === "function_call") calls.push(item);
			else if (item.type === "reasoning" || (item.type === "message" && item.role === "assistant")) hoisted.push(item);
			else break;
			index += 1;
		}
		const outputs: ResponsesItem[] = [];
		while (index < items.length && items[index]!.type === "function_call_output") {
			outputs.push(items[index]!);
			index += 1;
		}
		result.push(...hoisted, ...calls, ...outputs);
	}
	if (result.every((item, i) => item === items[i])) return undefined;
	return { ...payload, input: result };
}

export function createPstackExtension(options: PstackExtensionOptions = {}): (pi: ExtensionApi) => void {
	const packageRoot = options.packageRoot ?? DEFAULT_PACKAGE_ROOT;
	const homeDir = options.homeDir ?? homedir();
	const readText: ReadTextFileFn =
		options.readFile ?? options.filesystem?.readFile ?? ((path) => readFileSync(path, "utf8"));
	const removeFile: RemoveFileFn =
		options.removeFile ?? options.filesystem?.removeFile ?? ((path) => rmSync(path));
	const loadAgents = async (): Promise<AgentDefinition[]> => {
		const dir = join(packageRoot, "agents");
		const files = readdirSync(dir).filter((file) => file.endsWith(".md")).sort();
		const agents = await Promise.all(files.map(async (file) => {
			const { metadata } = parseSkillDocument(await readText(join(dir, file)));
			if (metadata.name !== "poteto-agent" && !metadata.name?.startsWith("pstack-")) return undefined;
			return parseAgentDefinition(metadata);
		}));
		return agents.filter((agent): agent is AgentDefinition => agent !== undefined);
	};

	return (pi: ExtensionApi): void => {
		assertSupportedOmpVersion(pi.pi?.VERSION);
		let modeActive = false;
		const projectModeStatus = (ctx: CommandContext): void => {
			if (!modeActive) {
				ctx.ui.setStatus(POTETO_STATUS_KEY, undefined);
				return;
			}
			const text = ctx.ui.theme.getSymbolPreset() === "ascii" ? "[P] poteto" : "🥔 poteto";
			ctx.ui.setStatus(POTETO_STATUS_KEY, text);
		};

		const loadSkill = async (name: string): Promise<SkillDocument> =>
			parseSkillDocument(await readText(join(packageRoot, "skills", name, "SKILL.md")));

		const sendPrompt = (prompt: string): void => {
			if (pi.sendUserMessage) pi.sendUserMessage(prompt);
			else pi.sendMessage?.({ role: "user", content: prompt });
		};

		for (const name of [...DIRECT_SKILLS, ...TEAM_KIT_SKILLS]) {
			pi.registerCommand(name, {
				description: `Apply the ${name} P-Stack skill`,
				async handler(args, ctx) {
					try {
						const skill = await loadSkill(name);
						if (name === "poteto-mode") {
							modeActive = true;
							pi.appendEntry(MODE_ENTRY_TYPE, { state: "ON" });
							projectModeStatus(ctx);
						}
						const argumentBlock = args === "" ? "" : `\n\nUser arguments (verbatim):\n${args}`;
						sendPrompt(`${skill.body.trimEnd()}${argumentBlock}`);
					} catch (error) {
						ctx.ui.notify?.(`Unable to load /${name}: ${errorMessage(error)}`, "error");
					}
				},
			});
		}

		pi.registerShortcut("ctrl+alt+o", {
			description: "Open a Poteto mode prompt",
			handler(ctx) {
				const draft = ctx.ui.getEditorText();
				if (draft === POTETO_COMMAND || draft.startsWith(`${POTETO_COMMAND} `)) return;
				ctx.ui.setEditorText(`${POTETO_COMMAND} ${draft}`);
			},
		});

		pi.registerCommand("pstack-off", {
			description: "Disable sticky P-Stack mode for this session",
			handler(_args, ctx) {
				modeActive = false;
				pi.appendEntry(MODE_ENTRY_TYPE, { state: "OFF" });
				projectModeStatus(ctx);
			},
		});

		const legacyRulePath = (): string => {
			const agentDir = pi.pi?.getAgentDir?.() ?? join(homeDir, ".omp", "agent");
			return join(agentDir, "rules", LEGACY_MODEL_RULE_BASENAME);
		};

		const deleteLegacyRule = async (ctx: CommandContext, rulePath: string): Promise<void> => {
			try {
				await removeFile(rulePath);
				ctx.ui.notify?.(`Deleted ${rulePath}.`, "info");
			} catch (error) {
				let code: unknown;
				if (error && typeof error === "object" && "code" in error) code = error.code;
				if (code !== "ENOENT") ctx.ui.notify?.(`Unable to delete ${rulePath}: ${errorMessage(error)}`, "error");
			}
		};

		pi.registerCommand("pstack-status", {
			description: "Show sticky P-Stack mode status",
			handler(_args, ctx) {
				ctx.ui.notify?.(`P-Stack mode is ${modeActive ? "ON" : "OFF"}.\nUse /setup-pstack to see agent model assignments.`, "info");
			},
		});

		pi.registerCommand("setup-pstack", {
			description: "Show P-Stack agents and their model assignments",
			async handler(_args, ctx) {
				const rulePath = legacyRulePath();
				if (
					existsSync(rulePath) &&
					(await ctx.ui.confirm(
						"Delete legacy P-Stack model rule?",
						`${rulePath} is no longer read. Agent models now come from /agents. Delete it?`,
					))
				) {
					await deleteLegacyRule(ctx, rulePath);
				}
				try {
					const agents = await loadAgents();
					const overrides = pi.pi?.settings?.get?.("task.agentModelOverrides");
					const disabled = new Set(pi.pi?.settings?.get?.("task.disabledAgents") ?? []);
					ctx.ui.notify?.(
						[
							"P-Stack agents:",
							...agents.map(({ name, description, model }) => {
								const effective = overrides?.[name] ?? model;
								return `${name}: ${Array.isArray(effective) ? effective.join(", ") : effective}${disabled.has(name) ? " (disabled)" : ""}. ${description}`;
							}),
							"Set each agent's model and thinking level in /agents. Defaults follow OMP's built-in roles (@task, @slow, @default).",
						].join("\n"),
						"info",
					);
				} catch (error) {
					ctx.ui.notify?.(`Unable to load P-Stack agents: ${errorMessage(error)}`, "error");
				}
				if (
					!hasVerificationSkill(ctx.cwd) &&
					(await ctx.ui.confirm(
						"Create a project verification skill?",
						"No .omp/skills/verify-* skill found. Draft /create-verification-skill so agents can prove changes on the real app?",
					))
				) {
					ctx.ui.setEditorText("/create-verification-skill ");
				}
			},
		});

		pi.registerCommand("pstack-cleanup", {
			description: "Clear P-Stack agent overrides, disabled agents, and the legacy rule",
			async handler(_args, ctx) {
				const rulePath = legacyRulePath();
				const agents = await loadAgents();
				const names = new Set(agents.map(({ name }) => name));
				const confirmed = await ctx.ui.confirm(
					"Reset P-Stack agent configuration?",
					`Clear /agents model overrides and disabled entries for ${[...names].join(", ")}, and delete ${rulePath} if present?`,
				);
				if (!confirmed) return;
				const settings = pi.pi?.settings;
				const overrides = settings?.get?.("task.agentModelOverrides");
				if (overrides && [...names].some((name) => Object.hasOwn(overrides, name))) {
					const remaining = { ...overrides };
					for (const name of names) delete remaining[name];
					settings?.set?.("task.agentModelOverrides", remaining);
				}
				const disabled = settings?.get?.("task.disabledAgents");
				if (disabled?.some((name) => names.has(name))) {
					settings?.set?.("task.disabledAgents", disabled.filter((name) => !names.has(name)));
				}
				await deleteLegacyRule(ctx, rulePath);
				ctx.ui.notify?.("P-Stack agent configuration reset. Set models and thinking levels in /agents.", "info");
			},
		});

		const reconstructMode = (_event: unknown, ctx: CommandContext): void => {
			const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.() ?? [];
			modeActive = latestModeState(entries);
			projectModeStatus(ctx);
		};
		for (const event of ["session_start", "session_switch", "session_branch", "session_tree"]) {
			pi.on(event, reconstructMode);
		}

		pi.on("before_agent_start", async (event: { systemPrompt?: string | string[] }) => {
			if (!modeActive) return undefined;
			let reminder = DEFAULT_REMINDER;
			try {
				const skill = await loadSkill("poteto-mode");
				reminder = skill.metadata.reminder || reminder;
			} catch {
				reminder = DEFAULT_REMINDER;
			}
			const stickySegment = `<pstack-mode>${reminder}</pstack-mode>`;
			const prior = event.systemPrompt;
			return {
				systemPrompt: Array.isArray(prior)
					? [...prior, stickySegment]
					: prior
						? [prior, stickySegment]
						: [stickySegment],
			};
		});

		pi.on("before_provider_request", (event: unknown) => {
			if (!event || typeof event !== "object" || !("payload" in event)) return undefined;
			return normalizeResponsesToolTurns(event.payload);
		});

		pi.on("before_subagent_spawn", (event: SubagentSpawnEvent, ctx: CommandContext) => {
			if (event.agent !== "pstack-cross-judge") return undefined;
			const models = ctx.models;
			const sessionModel = ctx.model ?? models?.current();
			if (!models || !sessionModel) return undefined;
			const family = models.family(sessionModel);
			const firstDifferent = event.patterns.findIndex((pattern) => {
				const model = models.resolve(pattern);
				return model !== undefined && models.family(model) !== family;
			});
			if (firstDifferent <= 0) return undefined;
			const selector = event.patterns[firstDifferent]!;
			return {
				model: [selector, ...event.patterns.slice(0, firstDifferent), ...event.patterns.slice(firstDifferent + 1)],
				note: `pstack-cross-judge: preferring ${selector} from a different family than the session`,
			};
		});
	};
}

const pstackExtension = createPstackExtension();
export default pstackExtension;
