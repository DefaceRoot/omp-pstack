/**
 * Child AgentDefinition + ExecutorOptions capabilities at the raw runSubprocess seam.
 *
 * Source of truth (OMP 17.2.13 installed cache):
 * - ExecutorOptions: `@oh-my-pi/pi-coding-agent@17.2.13` `src/task/executor.ts` ~379-412
 *   (`outputSchema?`, `outputSchemaMode?`, `taskDepth?`, `restrictToolNames?`)
 * - `restrictToolNames: true` disables MCP and clears preloaded extension/custom-tool
 *   paths (~3004-3079); executor always sets `requireYieldTool: true` on the child
 *   session (not a public ExecutorOptions field callers must pass).
 * - Yield contract: `src/tools/yield.ts` ~316-380 — success needs non-null `result.data`;
 *   data-less / type-only yields are rejected.
 *
 * AgentDefinition must still carry a nonempty built-in tool whitelist excluding
 * recursive launchers (`task`, `pstack_task`) and empty `spawns`. Yield stays
 * available via the executor's forced requireYieldTool, not by listing `yield`
 * (or recursive task tools) on agent.tools.
 */
export type AgentCapabilitySnapshot = {
	tools?: unknown;
	spawns?: unknown;
	systemPrompt?: unknown;
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
 * `yield` with non-null `result.data` text — never a data-less / type-only yield
 * (matches yield.ts success path around 316-380).
 */
export function requiresTerminalYieldWithTextData(systemPrompt: unknown): boolean {
	if (typeof systemPrompt !== "string" || systemPrompt.trim() === "") return false;
	if (!/\byield\b/i.test(systemPrompt)) return false;
	if (!/result\.data/i.test(systemPrompt)) return false;
	if (!/non-?null/i.test(systemPrompt)) return false;
	if (!/(data-?less|type-?only)/i.test(systemPrompt)) return false;
	return true;
}

/** Public ExecutorOptions flag: suppress discovered/reloaded extensions + MCP. */
export function hasRestrictedToolNames(options: { restrictToolNames?: unknown } | null | undefined): boolean {
	return options?.restrictToolNames === true;
}
