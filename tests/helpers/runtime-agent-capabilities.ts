/**
 * Child AgentDefinition + ExecutorOptions capabilities at the raw runSubprocess seam.
 *
 * Source of truth (OMP 17.2.13 installed cache):
 * - ExecutorOptions: `@oh-my-pi/pi-coding-agent@17.2.13` `src/task/executor.ts`
 *   (`outputSchema?`, `outputSchemaMode?`, `enableMCP?`, `preloadedExtensionPaths?`,
 *   `preloadedCustomToolPaths?`, `restrictToolNames?`)
 * - AgentDefinition: `src/task/types.ts` (`tools?: string[]`, `spawns?: string[] | "*"`)
 * - When `agent.tools` is omitted (or empty), executor leaves toolNames unset so the
 *   standard OMP built-in surface remains available (todo, web_search, browser, ask,
 *   inspect_image, …). A nonempty six-tool whitelist silently drops those.
 * - When `agent.spawns !== undefined` (including `spawns: []`), executor.ts auto-adds
 *   active `task` whenever a tools whitelist is present. Omitting `spawns` maps to
 *   empty `spawnsEnv` without activating `task`. Prefer both `tools` and `spawns`
 *   omitted to keep standard built-ins without recursive native delegation.
 * - `restrictToolNames: true` disables MCP (`enableMCP = !restrictToolNames && …`) and
 *   clears preloaded extension/custom-tool paths. Why/Reflect need child MCP, so
 *   pstack_task must keep `enableMCP: true`, pass empty preload arrays to block
 *   recursive extension reload, and leave `restrictToolNames` omitted/not-true.
 * - Yield contract: `src/tools/yield.ts` — success needs non-null `result.data`.
 *
 * Require omitting both `agent.tools` and `agent.spawns`.
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

/**
 * Require omitted `agent.tools` (standard OMP built-ins remain available) AND
 * omitted `agent.spawns` (avoids executor auto-adding recursive `task` when
 * `spawns !== undefined`, including empty arrays).
 */
export function preservesStandardNativeToolsWithoutRecursion(
	agent: AgentCapabilitySnapshot | null | undefined,
): boolean {
	if (!agent) return false;
	// Both must be omitted: tools whitelist drops standard built-ins; spawns:[]
	// still counts as defined and auto-adds task when a tools list is present.
	if (agent.tools !== undefined) return false;
	if (agent.spawns !== undefined) return false;
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
