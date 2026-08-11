/**
 * Child AgentDefinition + ExecutorOptions capabilities at the raw runSubprocess seam.
 *
 * Source of truth (OMP 17.2.13 installed cache):
 * - ExecutorOptions: `@oh-my-pi/pi-coding-agent@17.2.13` `src/task/executor.ts`
 *   (`outputSchema?`, `outputSchemaMode?`, `enableMCP?`, `preloadedExtensionPaths?`,
 *   `preloadedCustomToolPaths?`, `restrictToolNames?`)
 * - `restrictToolNames: true` disables MCP (`enableMCP = !restrictToolNames && …`) and
 *   clears preloaded extension/custom-tool paths. Why/Reflect need child MCP, so
 *   pstack_task must keep `enableMCP: true`, pass empty preload arrays to block
 *   recursive extension reload, and leave `restrictToolNames` omitted/not-true.
 * - Yield contract: `src/tools/yield.ts` — success needs non-null `result.data`.
 *
 * AgentDefinition must still carry a nonempty built-in tool whitelist excluding
 * recursive launchers (`task`, `pstack_task`) and empty `spawns`.
 */
export type AgentCapabilitySnapshot = {
	tools?: unknown;
	spawns?: unknown;
	systemPrompt?: unknown;
};

export type ChildRunnerPolicySnapshot = {
	enableMCP?: unknown;
	restrictToolNames?: unknown;
	preloadedExtensionPaths?: unknown;
	preloadedCustomToolPaths?: unknown;
};

export function hasNonRecursiveBuiltInToolWhitelist(agent: AgentCapabilitySnapshot | null | undefined): boolean {
	if (!agent || !Array.isArray(agent.tools) || agent.tools.length === 0) return false;
	if (!agent.tools.every((tool) => typeof tool === "string" && tool.trim() !== "")) return false;
	if (agent.tools.includes("task") || agent.tools.includes("pstack_task")) return false;
	if (!Array.isArray(agent.spawns) || agent.spawns.length !== 0) return false;
	return true;
}

/**
 * Poteto/fallback AgentDefinition systemPrompt must explicitly require a terminal
 * `yield` with non-null `result.data` text — never a data-less / type-only yield.
 */
export function requiresTerminalYieldWithTextData(systemPrompt: unknown): boolean {
	if (typeof systemPrompt !== "string" || systemPrompt.trim() === "") return false;
	if (!/\byield\b/i.test(systemPrompt)) return false;
	if (!/result\.data/i.test(systemPrompt)) return false;
	if (!/non-?null/i.test(systemPrompt)) return false;
	if (!/(data-?less|type-?only)/i.test(systemPrompt)) return false;
	return true;
}

/**
 * Preserve child MCP while blocking recursive extension/custom-tool reload:
 * enableMCP:true, empty preload arrays, restrictToolNames omitted/not-true.
 */
export function preservesChildMcpWithoutExtensionReload(
	options: ChildRunnerPolicySnapshot | null | undefined,
): boolean {
	if (!options) return false;
	if (options.enableMCP !== true) return false;
	if (options.restrictToolNames === true) return false;
	if (!Array.isArray(options.preloadedExtensionPaths) || options.preloadedExtensionPaths.length !== 0) {
		return false;
	}
	if (!Array.isArray(options.preloadedCustomToolPaths) || options.preloadedCustomToolPaths.length !== 0) {
		return false;
	}
	return true;
}
