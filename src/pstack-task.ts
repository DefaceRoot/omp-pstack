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

export type RunSubprocessOptions = {
	id: string;
	index: number;
	task: string;
	cwd: string;
	modelOverride?: string;
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
};

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

export type ExecuteAssignmentsOptions = {
	runSubprocess: RunSubprocessFn;
	cwd: string;
	signal?: AbortSignal;
	onProgress?: (progress: AssignmentProgress) => void;
	modelRegistry?: unknown;
	settings?: unknown;
	agentPrompt?: string;
	runtimeIdPrefix?: string;
};

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

const FALLBACK_AGENT: AgentDefinition = {
	name: "poteto-agent",
	description: "P-Stack parallel worker",
	systemPrompt: "Complete the assigned task thoroughly and return the result.",
	source: "project",
};

function assignmentAgent(agentPrompt: string | undefined): AgentDefinition {
	const systemPrompt = agentPrompt?.trim();
	if (!systemPrompt) return FALLBACK_AGENT;
	return {
		...FALLBACK_AGENT,
		systemPrompt,
	};
}

/** Execute every assignment immediately and retain input order in the returned details. */
export async function executeAssignments(
	assignments: readonly Assignment[],
	options: ExecuteAssignmentsOptions,
): Promise<AssignmentResult[]> {
	const agent = assignmentAgent(options.agentPrompt);
	return Promise.all(
		assignments.map(async (assignment, index) => {
			if (options.signal?.aborted) return cancelledResult(assignment.id);

			options.onProgress?.({ id: assignment.id, index, state: "started" });
			let result: AssignmentResult;
			try {
				result = await options.runSubprocess({
					id: options.runtimeIdPrefix ? `${options.runtimeIdPrefix}-${index}` : assignment.id,
					index,
					task: assignment.task,
					cwd: options.cwd,
					modelOverride: assignment.modelOverride,
					signal: options.signal,
					onProgress: (progress) =>
						options.onProgress?.({ id: assignment.id, index, state: "progress", progress }),
					modelRegistry: options.modelRegistry,
					settings: options.settings,
					agent,
					enableLsp: false,
				});
			} catch (error) {
				result = options.signal?.aborted ? cancelledResult(assignment.id) : failedResult(assignment.id, error);
			}
			options.onProgress?.({ id: assignment.id, index, state: "completed", result });
			return result;
		}),
	);
}
