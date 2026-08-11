import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, rmSync } from "node:fs";
import {
	executeAssignments,
	expandAssignments,
	type AssignmentRequest,
	type RunSubprocessFn,
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

type CommandContext = {
	cwd: string;
	ui: {
		notify?: (message: string, level?: string) => void;
		confirm: (title: string, message: string) => Promise<boolean>;
	};
	sessionManager: {
		getBranch?: () => unknown[];
		getEntries?: () => unknown[];
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
		settings?: unknown;
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

function activeModelSelector(ctx: CommandContext): string | undefined {
	const model = ctx.model ?? ctx.models?.current?.();
	if (!model?.provider || !model.id) return undefined;
	return `${model.provider}/${model.id}`;
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

export function createPstackExtension(options: PstackExtensionOptions = {}): (pi: ExtensionApi) => void {
	const packageRoot = options.packageRoot ?? DEFAULT_PACKAGE_ROOT;
	const homeDir = options.homeDir ?? homedir();
	const readText: ReadTextFileFn =
		options.readFile ?? options.filesystem?.readFile ?? ((path) => readFileSync(path, "utf8"));
	const removeFile: RemoveFileFn =
		options.removeFile ?? options.filesystem?.removeFile ?? ((path) => rmSync(path));

	return (pi: ExtensionApi): void => {
		let modeActive = false;

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
						}
						const argumentBlock = args === "" ? "" : `\n\nUser arguments (verbatim):\n${args}`;
						sendPrompt(`${skill.body.trimEnd()}${argumentBlock}`);
					} catch (error) {
						ctx.ui.notify?.(`Unable to load /${name}: ${errorMessage(error)}`, "error");
					}
				},
			});
		}

		pi.registerCommand("pstack-off", {
			description: "Disable sticky P-Stack mode for this session",
			handler() {
				modeActive = false;
				pi.appendEntry(MODE_ENTRY_TYPE, { state: "OFF" });
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
				const rulePath = join(homeDir, ".omp", "agent", "rules", MODEL_RULE_BASENAME);
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

				asToolUpdate(onUpdate, `Launching ${assignments.length} P-Stack assignment(s)...`);
				const results = await executeAssignments(assignments, {
					runSubprocess,
					cwd: ctx.cwd,
					signal,
					modelRegistry: ctx.modelRegistry ?? ctx.models?.registry,
					settings: pi.pi?.settings,
					agentPrompt,
					runtimeIdPrefix: `pstack-${toolCallId}`,
					onProgress(progress) {
						if (progress.state === "completed") {
							asToolUpdate(onUpdate, `Completed ${progress.id} (exit ${progress.result?.exitCode ?? "?"}).`);
						}
					},
				});
				const text = results
					.map((result, index) => {
						const workerText = [result.output, result.error, result.stderr].find(
							(value) => typeof value === "string" && value.trim() !== "",
						);
						const logicalId = assignments[index]?.id ?? result.id;
						return `${logicalId}: exit ${result.exitCode}${workerText ? `\n${workerText}` : ""}`;
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
