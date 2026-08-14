import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, rmSync } from "node:fs";
import {
	createLiveConcurrencyLimiter,
	executeAssignments,
	expandAssignments,
	type AssignmentProgress,
	type AssignmentRequest,
	type AssignmentResult,
	type ChildLifecyclePolicy,
	type RunSubprocessFn,
	type SubprocessProgress,
} from "./pstack-task.ts";

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
	"setup-pstack",
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
const MODEL_RULE_BASENAME = "pstack-models.md";
const DEFAULT_REMINDER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

export type ReadTextFileFn = (path: string) => string | Promise<string>;
export type RemoveFileFn = (path: string) => void | Promise<void>;

export type PstackExtensionOptions = {
	packageRoot?: string;
	homeDir?: string;
	runSubprocess?: RunSubprocessFn;
	readFile?: ReadTextFileFn;
	removeFile?: RemoveFileFn;
	filesystem?: {
		readFile?: ReadTextFileFn;
		removeFile?: RemoveFileFn;
	};
};

type ActiveModel = {
	provider: string;
	id: string;
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
		theme: {
			getSymbolPreset: () => SymbolPreset;
		};
	};
	sessionManager: {
		getBranch?: () => unknown[];
		getEntries?: () => unknown[];
		getArtifactsDir?: () => string | null | undefined;
	};
	model?: ActiveModel;
	modelRegistry?: unknown;
	models?: {
		registry?: unknown;
		current?: () => ActiveModel | undefined;
	};
};

type ExtensionApi = {
	registerCommand: (
		name: string,
		options: {
			description?: string;
			handler: (args: string, ctx: CommandContext) => void | Promise<void>;
		},
	) => void;
	registerShortcut: (
		shortcut: string,
		options: {
			description?: string;
			handler: (ctx: CommandContext) => void | Promise<void>;
		},
	) => void;
	registerTool: (tool: Record<string, unknown>) => void;
	on: (
		event: string,
		handler:
			| ((event: unknown, ctx: CommandContext) => unknown)
			| ((event: { systemPrompt?: string | string[] }, ctx: CommandContext) => unknown),
	) => void;
	appendEntry: (customType: string, data?: unknown) => void;
	sendUserMessage?: (content: unknown, options?: unknown) => void;
	sendMessage?: (message: unknown, options?: unknown) => void;
	zod: {
		object: (shape: Record<string, unknown>) => unknown;
		string: () => unknown;
		array: (schema: unknown) => unknown;
	};
	pi?: {
		runSubprocess?: RunSubprocessFn;
		settings?: {
			get?: (key: string) => unknown;
		};
		getAgentDir?: () => string;
		VERSION?: string;
	};
};

type SkillDocument = {
	body: string;
	metadata: Record<string, string>;
};

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

function optionalSchema(schema: unknown): unknown {
	if (
		schema &&
		(typeof schema === "object" || typeof schema === "function") &&
		"optional" in schema &&
		typeof schema.optional === "function"
	) {
		return schema.optional();
	}
	return schema;
}

function asToolUpdate(onUpdate: unknown, text: string): void {
	if (typeof onUpdate !== "function") return;
	onUpdate({ content: [{ type: "text", text }] });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function nonemptyResultText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	return text === "" ? undefined : text;
}

function resultTextKey(text: string): string {
	return text.replace(/\s+/g, " ");
}

const SAFE_SLICE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const RESULT_LINE_OR_CONTROL = /\r\n|[\n\r\u2028\u2029\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

function frameResultLines(channel: "output" | "error" | "stderr", text: string): string {
	const prefix = `  ${channel}: `;
	const framed = text.replace(RESULT_LINE_OR_CONTROL, (character) => {
		const code = character.charCodeAt(0);
		if (code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029) {
			return `\n${prefix}`;
		}
		return `\\u${code.toString(16).padStart(4, "0")}`;
	});
	return prefix + framed;
}

/** One roster row's lifecycle, carrying only the detail its state can actually report. */
type RosterState =
	| { kind: "queued" }
	| { kind: "started" }
	| { kind: "progress"; detail?: string; requests?: string; tokens?: string }
	| { kind: "completed"; exitCode: number | undefined };

type RosterRow = {
	id: string;
	model: string;
	state: RosterState;
};

const ROSTER_DETAIL_FIELDS = ["status", "lastIntent", "currentTool", "message"] as const;
const MAX_ROSTER_DETAIL_LENGTH = 160;
const MAX_ROSTER_COUNTER_LENGTH = 24;
const ROSTER_CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/g;

/** Flatten child-reported text to one readable line so a row never breaks the roster layout. */
function rosterText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.replace(ROSTER_CONTROL_CHARACTER, " ").replace(/\s+/g, " ").trim();
	if (text === "") return undefined;
	return text.length > MAX_ROSTER_DETAIL_LENGTH ? `${text.slice(0, MAX_ROSTER_DETAIL_LENGTH)}...` : text;
}

function rosterCounter(value: unknown): string | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
	const text = rosterText(value);
	return text !== undefined && text.length <= MAX_ROSTER_COUNTER_LENGTH ? text : undefined;
}

function rosterStateFor(progress: AssignmentProgress): RosterState {
	switch (progress.state) {
		case "started":
			return { kind: "started" };
		case "progress": {
			const source: SubprocessProgress = progress.progress ?? {};
			const details: string[] = [];
			for (const field of ROSTER_DETAIL_FIELDS) {
				const text = rosterText(source[field]);
				if (text !== undefined && !details.includes(text)) details.push(text);
			}
			return {
				kind: "progress",
				detail: details.length === 0 ? undefined : details.join(" | "),
				requests: rosterCounter(source.requests),
				tokens: rosterCounter(source.tokens),
			};
		}
		case "completed":
			return { kind: "completed", exitCode: progress.result?.exitCode };
	}
}

/** Every update is a whole-roster snapshot: one row per assignment, newest state in place. */
function rosterSnapshot(rows: readonly RosterRow[]): string {
	let finished = 0;
	let inFlight = 0;
	const lines: string[] = [];
	for (const row of rows) {
		if (row.state.kind === "completed") finished += 1;
		else if (row.state.kind !== "queued") inFlight += 1;
		lines.push(renderRosterRow(row));
	}
	let headline = `P-Stack: ${finished}/${rows.length} assignment(s) finished, ${inFlight} in flight.`;
	if (finished === 0 && inFlight === 0) headline = `Launching ${rows.length} P-Stack assignment(s)...`;
	else if (finished === rows.length) headline = `P-Stack finished ${rows.length} assignment(s).`;
	return [headline, ...lines].join("\n");
}

function renderRosterRow(row: RosterRow): string {
	const head = `  ${row.id} [${row.model}]`;
	switch (row.state.kind) {
		case "queued":
			return `${head} queued`;
		case "started":
			return `${head} started`;
		case "progress": {
			const counters: string[] = [];
			if (row.state.requests !== undefined) counters.push(`requests ${row.state.requests}`);
			if (row.state.tokens !== undefined) counters.push(`tokens ${row.state.tokens}`);
			let line = `${head} progress`;
			if (counters.length > 0) line += ` (${counters.join(", ")})`;
			return row.state.detail === undefined ? line : `${line}: ${row.state.detail}`;
		}
		case "completed":
			return `${head} completed exit ${row.state.exitCode ?? "?"}`;
	}
}

function activeModelSelector(ctx: CommandContext): string | undefined {
	const model = ctx.model ?? ctx.models?.current?.();
	if (!model?.provider || !model.id) return undefined;
	return `${model.provider}/${model.id}`;
}

function childLifecyclePolicy(ctx: CommandContext): ChildLifecyclePolicy {
	const artifactsDir = ctx.sessionManager.getArtifactsDir?.();
	if (typeof artifactsDir === "string" && artifactsDir.length > 0) {
		return { kind: "persisted", artifactsDir };
	}
	return { kind: "ephemeral" };
}

function parseAssignmentRequest(params: Record<string, unknown>): AssignmentRequest {
	if (params.strategy === "panel") {
		if (typeof params.prompt !== "string") throw new Error("panel strategy requires a prompt");
		if (params.model !== undefined && typeof params.model !== "string") {
			throw new Error("panel model must be a string");
		}
		let models: string[] | undefined;
		if (params.models !== undefined) {
			if (!Array.isArray(params.models) || !params.models.every((model) => typeof model === "string")) {
				throw new Error("panel models must be an array of strings");
			}
			models = params.models;
		}
		return {
			strategy: "panel",
			prompt: params.prompt,
			models,
			model: params.model,
		};
	}

	if (params.strategy !== "slice") throw new Error("pstack_task strategy must be 'panel' or 'slice'");
	if (params.model !== undefined && typeof params.model !== "string") {
		throw new Error("slice model must be a string");
	}
	if (!Array.isArray(params.slices)) throw new Error("slice strategy requires slices");
	const slices = params.slices.map((slice, index) => {
		if (!slice || typeof slice !== "object") throw new Error(`slice ${index} must be an object`);
		if (!("id" in slice) || typeof slice.id !== "string" || slice.id === "") {
			throw new Error(`slice ${index} requires an id`);
		}
		if (!SAFE_SLICE_ID.test(slice.id)) {
			throw new Error(`slice ${index} id must be a safe token matching ${SAFE_SLICE_ID}`);
		}
		if (!("task" in slice) || typeof slice.task !== "string") {
			throw new Error(`slice ${index} requires a task`);
		}
		let model: string | undefined;
		if ("model" in slice && slice.model !== undefined) {
			if (typeof slice.model !== "string") throw new Error(`slice ${index} model must be a string`);
			model = slice.model;
		}
		return { id: slice.id, task: slice.task, model };
	});
	return { strategy: "slice", slices, model: params.model };
}

const DEFAULT_PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIN_OMP_VERSION = [17, 2, 13] as const;
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


export function createPstackExtension(options: PstackExtensionOptions = {}): (pi: ExtensionApi) => void {
	const packageRoot = options.packageRoot ?? DEFAULT_PACKAGE_ROOT;
	const homeDir = options.homeDir ?? homedir();
	const readText: ReadTextFileFn =
		options.readFile ?? options.filesystem?.readFile ?? ((path) => readFileSync(path, "utf8"));
	const removeFile: RemoveFileFn =
		options.removeFile ?? options.filesystem?.removeFile ?? ((path) => rmSync(path));

	return (pi: ExtensionApi): void => {
		assertSupportedOmpVersion(pi.pi?.VERSION);
		const scheduleAssignment = createLiveConcurrencyLimiter(
			() => pi.pi?.settings?.get?.("task.maxConcurrency"),
		);
		let modeActive = false;
		const projectModeStatus = (ctx: CommandContext): void => {
			if (!modeActive) {
				ctx.ui.setStatus(POTETO_STATUS_KEY, undefined);
				return;
			}
			const text = ctx.ui.theme.getSymbolPreset() === "ascii" ? "[P] poteto" : "🥔 poteto";
			ctx.ui.setStatus(POTETO_STATUS_KEY, text);
		};

		const loadDocument = async (relativePath: string): Promise<SkillDocument> =>
			parseSkillDocument(await readText(join(packageRoot, relativePath)));

		const loadSkill = (name: string): Promise<SkillDocument> =>
			loadDocument(join("skills", name, "SKILL.md"));

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

		pi.registerCommand("pstack-status", {
			description: "Show sticky P-Stack mode status",
			handler(_args, ctx) {
				ctx.ui.notify?.(`P-Stack mode is ${modeActive ? "ON" : "OFF"}.`, "info");
			},
		});

		pi.registerCommand("pstack-cleanup", {
			description: "Remove the P-Stack model routing rule",
			async handler(_args, ctx) {
				const agentDir =
					typeof pi.pi?.getAgentDir === "function"
						? pi.pi.getAgentDir()
						: join(homeDir, ".omp", "agent");
				const rulePath = join(agentDir, "rules", MODEL_RULE_BASENAME);
				const confirmed = await ctx.ui.confirm(
					"Remove P-Stack model rule?",
					`Delete only ${rulePath} (${MODEL_RULE_BASENAME})?`,
				);
				if (!confirmed) return;
				try {
					await removeFile(rulePath);
					ctx.ui.notify?.(`Deleted ${rulePath}.`, "info");
				} catch (error) {
					let code: unknown;
					if (error && typeof error === "object" && "code" in error) code = error.code;
					if (code !== "ENOENT") ctx.ui.notify?.(`Unable to delete ${rulePath}: ${errorMessage(error)}`, "error");
				}
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

		pi.on(
			"before_agent_start",
			async (event: { systemPrompt?: string | string[] }) => {
				if (!modeActive) return undefined;
				let reminder = DEFAULT_REMINDER;
				try {
					const skill = await loadSkill("poteto-mode");
					reminder = skill.metadata.reminder || reminder;
				} catch {
					// The built-in reminder still preserves sticky mode if package content is unavailable.
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
			},
		);

		const z = pi.zod;
		const stringSchema = z.string();
		const sliceSchema = z.object({
			id: stringSchema,
			task: stringSchema,
			model: optionalSchema(z.string()),
		});
		const parameters = z.object({
			strategy: z.string(),
			prompt: optionalSchema(z.string()),
			models: optionalSchema(z.array(z.string())),
			model: optionalSchema(z.string()),
			slices: optionalSchema(z.array(sliceSchema)),
		});

		pi.registerTool({
			name: "pstack_task",
			label: "P-Stack Task",
			description: "Run a model panel or independent P-Stack task slices concurrently.",
			parameters,
			async execute(
				toolCallId: string,
				params: Record<string, unknown>,
				signal: AbortSignal | undefined,
				onUpdate: unknown,
				ctx: CommandContext,
			) {
				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: "P-Stack task cancelled before launch." }],
						details: { strategy: params.strategy, assignments: [], results: [] },
					};
				}

				const request = parseAssignmentRequest(params);
				const assignments = expandAssignments(request, activeModelSelector(ctx));
				const runSubprocess = options.runSubprocess ?? pi.pi?.runSubprocess;
				if (!runSubprocess) throw new Error("pstack_task requires pi.pi.runSubprocess or an injected runSubprocess");

				let agentPrompt: string | undefined;
				try {
					agentPrompt = (await loadDocument(join("agents", "poteto-agent.md"))).body.trim();
				} catch {
					// Installed content may intentionally omit internal agent definitions.
				}

				const roster: RosterRow[] = assignments.map((assignment) => ({
					id: assignment.id,
					model: rosterText(assignment.modelOverride) ?? "inherit-parent",
					state: { kind: "queued" },
				}));
				asToolUpdate(onUpdate, rosterSnapshot(roster));
				const results = await executeAssignments(assignments, {
					runSubprocess,
					cwd: ctx.cwd,
					signal,
					modelRegistry: ctx.modelRegistry ?? ctx.models?.registry,
					settings: pi.pi?.settings,
					agentPrompt,
					schedule: scheduleAssignment,
					parentToolCallId: toolCallId,
					lifecycle: childLifecyclePolicy(ctx),
					onProgress(progress) {
						const row = roster[progress.index];
						if (!row) return;
						row.state = rosterStateFor(progress);
						asToolUpdate(onUpdate, rosterSnapshot(roster));
					},
				});
				const text = results
					.map((result, index) => {
						const logicalId = assignments[index]?.id ?? result.id;
						let rendered = `<<< begin pstack assignment >>>\n${logicalId}: exit ${result.exitCode}`;
						const output = nonemptyResultText(result.output);
						const outputKey = output === undefined ? undefined : resultTextKey(output);
						if (output !== undefined) rendered += `\n${frameResultLines("output", output)}`;
						if (result.exitCode === 0) return `${rendered}\n<<< end pstack assignment >>>`;

						const error = nonemptyResultText(result.error);
						const errorKey = error === undefined ? undefined : resultTextKey(error);
						if (error !== undefined && errorKey !== outputKey) {
							rendered += `\n${frameResultLines("error", error)}`;
						}

						const stderr = nonemptyResultText(result.stderr);
						const stderrKey = stderr === undefined ? undefined : resultTextKey(stderr);
						if (stderr !== undefined && stderrKey !== outputKey && stderrKey !== errorKey) {
							rendered += `\n${frameResultLines("stderr", stderr)}`;
						}
						return `${rendered}\n<<< end pstack assignment >>>`;
					})
					.join("\n");
				return {
					content: [{ type: "text", text: text || "No P-Stack assignments were requested." }],
					details: { strategy: request.strategy, assignments, results },
				};
			},
		});
	};
}

const pstackExtension = createPstackExtension();
export default pstackExtension;
