/**
 * Minimal fake ExtensionAPI + command context for behavioral runtime tests.
 * Tracks registrations, session custom entries, messages, confirms, and events.
 */

export type CustomSessionEntry = {
	type: "custom";
	customType: string;
	data?: unknown;
};

export type RegisteredCommand = {
	name: string;
	description?: string;
	handler: (args: string, ctx: FakeCommandContext) => void | Promise<void>;
};

export type RegisteredTool = {
	name: string;
	description?: string;
	parameters?: unknown;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: FakeCommandContext,
	) => unknown | Promise<unknown>;
};

export type SentMessage = {
	via: "sendMessage" | "sendUserMessage";
	payload: unknown;
	options?: unknown;
};

export type FakeCommandContext = {
	ui: {
		notify: (message: string, level?: string) => void;
		confirm: (title: string, message: string) => Promise<boolean>;
	};
	cwd: string;
	sessionManager: {
		getBranch: () => CustomSessionEntry[];
		getEntries: () => CustomSessionEntry[];
	};
	hasPendingMessages: () => boolean;
};

export type FakeExtensionAPI = {
	registerCommand: (
		name: string,
		options: {
			description?: string;
			handler: RegisteredCommand["handler"];
		},
	) => void;
	registerTool: (tool: RegisteredTool) => void;
	on: (event: string, handler: (...args: unknown[]) => unknown) => void;
	appendEntry: (customType: string, data?: unknown) => void;
	sendMessage: (message: unknown, options?: unknown) => void;
	sendUserMessage: (content: unknown, options?: unknown) => void;
	setLabel: (label: string) => void;
	zod: { object: (...args: unknown[]) => unknown; string: () => unknown; array: (...args: unknown[]) => unknown };
};

export type FakeRuntimeOptions = {
	cwd?: string;
	confirmResult?: boolean;
	initialEntries?: CustomSessionEntry[];
};

export type FakeRuntime = {
	api: FakeExtensionAPI;
	commands: Map<string, RegisteredCommand>;
	tools: Map<string, RegisteredTool>;
	entries: CustomSessionEntry[];
	sentMessages: SentMessage[];
	notifications: Array<{ message: string; level?: string }>;
	confirmCalls: Array<{ title: string; message: string }>;
	handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
	setConfirmResult: (value: boolean) => void;
	createContext: () => FakeCommandContext;
	invokeCommand: (name: string, args?: string) => Promise<void>;
	emitSessionStart: () => Promise<void>;
	emitBeforeAgentStart: (
		systemPrompt: string[],
		prompt?: string,
	) => Promise<{ systemPrompt?: string[] } | undefined>;
};

export function createFakeRuntime(options: FakeRuntimeOptions = {}): FakeRuntime {
	const commands = new Map<string, RegisteredCommand>();
	const tools = new Map<string, RegisteredTool>();
	const entries: CustomSessionEntry[] = [...(options.initialEntries ?? [])];
	const sentMessages: SentMessage[] = [];
	const notifications: Array<{ message: string; level?: string }> = [];
	const confirmCalls: Array<{ title: string; message: string }> = [];
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	let confirmResult = options.confirmResult ?? true;
	const cwd = options.cwd ?? process.cwd();

	const createContext = (): FakeCommandContext => ({
		ui: {
			notify(message, level) {
				notifications.push({ message, level });
			},
			async confirm(title, message) {
				confirmCalls.push({ title, message });
				return confirmResult;
			},
		},
		cwd,
		sessionManager: {
			getBranch: () => [...entries],
			getEntries: () => [...entries],
		},
		hasPendingMessages: () => false,
	});

	const api: FakeExtensionAPI = {
		registerCommand(name, opts) {
			commands.set(name, { name, description: opts.description, handler: opts.handler });
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		on(event, handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		appendEntry(customType, data) {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage(message, messageOptions) {
			sentMessages.push({ via: "sendMessage", payload: message, options: messageOptions });
		},
		sendUserMessage(content, messageOptions) {
			sentMessages.push({ via: "sendUserMessage", payload: content, options: messageOptions });
		},
		setLabel() {},
		zod: {
			object: () => ({}),
			string: () => ({}),
			array: () => ({}),
		},
	};

	return {
		api,
		commands,
		tools,
		entries,
		sentMessages,
		notifications,
		confirmCalls,
		handlers,
		setConfirmResult(value) {
			confirmResult = value;
		},
		createContext,
		async invokeCommand(name, args = "") {
			const command = commands.get(name);
			if (!command) {
				throw new Error(`Command not registered: ${name}`);
			}
			await command.handler(args, createContext());
		},
		async emitSessionStart() {
			const list = handlers.get("session_start") ?? [];
			const ctx = createContext();
			for (const handler of list) {
				await handler({ type: "session_start" }, ctx);
			}
		},
		async emitBeforeAgentStart(systemPrompt, prompt = "") {
			const list = handlers.get("before_agent_start") ?? [];
			const ctx = createContext();
			let current = systemPrompt;
			let modified = false;
			for (const handler of list) {
				const result = (await handler(
					{ type: "before_agent_start", prompt, images: undefined, systemPrompt: current },
					ctx,
				)) as { systemPrompt?: string[] | string } | undefined | void;
				if (result?.systemPrompt !== undefined) {
					current = typeof result.systemPrompt === "string" ? [result.systemPrompt] : result.systemPrompt;
					modified = true;
				}
			}
			return modified ? { systemPrompt: current } : undefined;
		},
	};
}
