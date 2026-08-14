import { randomUUID } from "node:crypto";

export type ModelSelection = string | undefined;

export type Assignment = {
	id: string;
	task: string;
	modelOverride?: string;
};

export type PanelRequest = {
	strategy: "panel";
	prompt: string;
	models?: string[];
	model?: string;
};

export type SliceRequest = {
	strategy: "slice";
	slices: Array<{
		id: string;
		task: string;
		model?: string;
	}>;
	model?: string;
};

export type AssignmentRequest = PanelRequest | SliceRequest;

export type SubprocessProgress = {
	id?: string;
	message?: string;
	[key: string]: unknown;
};

export type ChildLifecyclePolicy =
	| { kind: "persisted"; artifactsDir: string }
	| { kind: "ephemeral" };

type SubprocessLifecycleOptions =
	| { keepAlive: true; artifactsDir: string }
	| { keepAlive: false; artifactsDir?: never };

type RunSubprocessBaseOptions = {
	id: string;
	index: number;
	task: string;
	description: string;
	cwd: string;
	modelOverride?: string;
	parentToolCallId?: string;
	maxRuntimeMs: number;
	signal?: AbortSignal;
	onProgress?: (progress: SubprocessProgress) => void;
	modelRegistry?: unknown;
	settings?: unknown;
	agent?: {
		name: string;
		description: string;
		systemPrompt: string;
		source: "project";
	};
	enableLsp?: boolean;
	outputSchema?: unknown;
	outputSchemaMode?: "permissive" | "strict";
	enableMCP?: boolean;
	preloadedExtensionPaths?: string[];
	preloadedCustomToolPaths?: string[];
};

export type RunSubprocessOptions = RunSubprocessBaseOptions & SubprocessLifecycleOptions;

type AgentDefinition = NonNullable<RunSubprocessOptions["agent"]>;

export type AssignmentResult = {
	id: string;
	exitCode: number;
	error?: string;
	output?: string;
	stderr?: string;
	truncated?: boolean;
	durationMs?: number;
	tokens?: unknown;
	requests?: unknown;
	[key: string]: unknown;
};

export type RunSubprocessFn = (options: RunSubprocessOptions) => Promise<AssignmentResult>;

export type AssignmentProgress = {
	id: string;
	index: number;
	state: "started" | "progress" | "completed";
	progress?: SubprocessProgress;
	result?: AssignmentResult;
};
export type AssignmentScheduler = <T>(
	operation: () => Promise<T>,
	signal?: AbortSignal,
) => Promise<T>;

export type ExecuteAssignmentsOptions = {
	runSubprocess: RunSubprocessFn;
	cwd: string;
	signal?: AbortSignal;
	onProgress?: (progress: AssignmentProgress) => void;
	modelRegistry?: unknown;
	settings?: unknown;
	agentPrompt?: string;
	runtimeIdPrefix?: string;
	schedule?: AssignmentScheduler;
	parentToolCallId?: string;
	maxRuntimeMs?: number;
	lifecycle?: ChildLifecyclePolicy;
};

export const DEFAULT_CHILD_MAX_RUNTIME_MS = 600_000;
const DEFAULT_TASK_MAX_CONCURRENCY = 32;

function normalizedConcurrency(value: unknown): number {
	if (value === 0) return Number.POSITIVE_INFINITY;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_TASK_MAX_CONCURRENCY;
	}
	return Math.max(1, Math.floor(value));
}

class AssignmentSchedulingCancelledError extends Error {
	constructor() {
		super("Cancelled before assignment launch");
		this.name = "AbortError";
	}
}

type QueuedAssignment = {
	run: () => Promise<void>;
	reject: (error: unknown) => void;
	signal?: AbortSignal;
	abortListener?: () => void;
};

export function createLiveConcurrencyLimiter(readMaxConcurrency: () => unknown): AssignmentScheduler {
	let active = 0;
	const queue: QueuedAssignment[] = [];

	const removeAbortListener = (entry: QueuedAssignment): void => {
		if (!entry.signal || !entry.abortListener) return;
		entry.signal.removeEventListener("abort", entry.abortListener);
		entry.abortListener = undefined;
	};

	const drain = (): void => {
		while (queue.length > 0 && active < normalizedConcurrency(readMaxConcurrency())) {
			const entry = queue.shift();
			if (!entry) return;
			removeAbortListener(entry);
			active += 1;
			void entry.run().finally(() => {
				active -= 1;
				drain();
			});
		}
	};

	return <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			if (signal?.aborted) {
				reject(new AssignmentSchedulingCancelledError());
				return;
			}

			const entry: QueuedAssignment = {
				run: async () => {
					try {
						resolve(await operation());
					} catch (error) {
						reject(error);
					}
				},
				reject,
				signal,
			};
			if (signal) {
				entry.abortListener = () => {
					const index = queue.indexOf(entry);
					if (index < 0) return;
					queue.splice(index, 1);
					removeAbortListener(entry);
					entry.reject(new AssignmentSchedulingCancelledError());
					drain();
				};
				signal.addEventListener("abort", entry.abortListener, { once: true });
			}
			queue.push(entry);
			drain();
		});
}

/** Map P-Stack's inheritance sentinels to the active parent model selector. */
export function resolveModelOverride(
	model: ModelSelection,
	parentModelOverride?: string,
): string | undefined {
	if (model === undefined) return undefined;
	const normalized = model.trim();
	if (normalized === "" || normalized === "auto" || normalized === "inherit-parent") return parentModelOverride;
	return normalized;
}

/** Expand a panel or a set of independent slices into the one internal assignment form. */
export function expandAssignments(
	request: AssignmentRequest,
	parentModelOverride?: string,
): Assignment[] {
	if (request.strategy === "panel") {
		const models = request.models ?? [request.model];
		return models.map((model, index) => ({
			id: `panel-${index}`,
			task: request.prompt,
			modelOverride: resolveModelOverride(model, parentModelOverride),
		}));
	}

	return request.slices.map((slice) => ({
		id: slice.id,
		task: slice.task,
		modelOverride: resolveModelOverride(slice.model ?? request.model, parentModelOverride),
	}));
}

function cancelledResult(id: string): AssignmentResult {
	return { id, exitCode: 130, error: "Cancelled" };
}

function failedResult(id: string, error: unknown): AssignmentResult {
	return {
		id,
		exitCode: 1,
		error: error instanceof Error ? error.message : String(error),
	};
}

const TERMINAL_YIELD_INSTRUCTION =
	"Finish by calling terminal `yield` with non-null `result.data` text. A data-less or type-only yield is forbidden.";

const FALLBACK_AGENT: AgentDefinition = {
	name: "poteto-agent",
	description: "P-Stack parallel worker",
	systemPrompt: `Complete the assigned task thoroughly and return the result.\n\n${TERMINAL_YIELD_INSTRUCTION}`,
	source: "project",
};

function assignmentAgent(agentPrompt: string | undefined): AgentDefinition {
	const systemPrompt = agentPrompt?.trim();
	if (!systemPrompt) return FALLBACK_AGENT;
	return {
		...FALLBACK_AGENT,
		systemPrompt: `${systemPrompt}\n\n${TERMINAL_YIELD_INSTRUCTION}`,
	};
}

function subprocessLifecycleOptions(policy: ChildLifecyclePolicy): SubprocessLifecycleOptions {
	switch (policy.kind) {
		case "persisted":
			return { artifactsDir: policy.artifactsDir, keepAlive: true };
		case "ephemeral":
			return { keepAlive: false };
	}
}

/** Execute every assignment immediately and retain input order in the returned details. */
export async function executeAssignments(
	assignments: readonly Assignment[],
	options: ExecuteAssignmentsOptions,
): Promise<AssignmentResult[]> {
	const agent = assignmentAgent(options.agentPrompt);
	const lifecyclePolicy = options.lifecycle ?? { kind: "ephemeral" };
	const lifecycle = subprocessLifecycleOptions(lifecyclePolicy);
	const runtimeIdPrefix =
		options.runtimeIdPrefix ??
		(lifecyclePolicy.kind === "persisted" ? `pstack-${randomUUID()}` : undefined);
	const maxRuntimeMs = options.maxRuntimeMs ?? DEFAULT_CHILD_MAX_RUNTIME_MS;
	const runAssignment = async (assignment: Assignment, index: number): Promise<AssignmentResult> => {
		if (options.signal?.aborted) return cancelledResult(assignment.id);

		options.onProgress?.({ id: assignment.id, index, state: "started" });
		let result: AssignmentResult;
		try {
			result = await options.runSubprocess({
				id: runtimeIdPrefix === undefined ? assignment.id : `${runtimeIdPrefix}-${index}`,
				index,
				task: assignment.task,
				description: assignment.id,
				cwd: options.cwd,
				modelOverride: assignment.modelOverride,
				parentToolCallId: options.parentToolCallId,
				maxRuntimeMs,
				...lifecycle,
				signal: options.signal,
				onProgress: (progress) =>
					options.onProgress?.({ id: assignment.id, index, state: "progress", progress }),
				modelRegistry: options.modelRegistry,
				settings: options.settings,
				agent,
				enableLsp: false,
				outputSchema: { type: "string" },
				outputSchemaMode: "strict",
				enableMCP: true,
				preloadedExtensionPaths: [],
				preloadedCustomToolPaths: [],
			});
			if (result.id !== assignment.id) {
				result = { ...result, runtimeId: result.id, id: assignment.id };
			}
		} catch (error) {
			result = options.signal?.aborted ? cancelledResult(assignment.id) : failedResult(assignment.id, error);
		}
		options.onProgress?.({ id: assignment.id, index, state: "completed", result });
		return result;
	};

	return Promise.all(
		assignments.map(async (assignment, index) => {
			const operation = () => runAssignment(assignment, index);
			try {
				return options.schedule
					? await options.schedule(operation, options.signal)
					: await operation();
			} catch (error) {
				if (!(error instanceof AssignmentSchedulingCancelledError)) throw error;
				return cancelledResult(assignment.id);
			}
		}),
	);
}
