/**
 * Child AgentDefinition capabilities required at the raw runSubprocess seam.
 *
 * A nonempty built-in tool whitelist must exclude recursive task launchers
 * (`task`, `pstack_task`) and declare empty `spawns` so a child extension reload
 * cannot recurse or reset task depth. Yield stays available via requireYieldTool
 * rather than being listed on the agent tools whitelist.
 *
 * OMP 17.2.13 also requires `restrictToolNames: true` on runSubprocess options
 * (suppresses discovered/reloaded extensions + MCP; agent.tools alone is not enough)
 * and a systemPrompt that demands a terminal `yield` with non-null `result.data` text.
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
 * `yield` carrying non-null `result.data` text — never a data-less / type-only yield.
 */
export function requiresTerminalYieldWithTextData(systemPrompt: unknown): boolean {
	if (typeof systemPrompt !== "string" || systemPrompt.trim() === "") return false;
	if (!/\byield\b/i.test(systemPrompt)) return false;
	if (!/result\.data/i.test(systemPrompt)) return false;
	if (!/non-?null/i.test(systemPrompt)) return false;
	if (!/(data-?less|type-?only)/i.test(systemPrompt)) return false;
	return true;
}

export function hasRestrictedToolNames(options: { restrictToolNames?: unknown } | null | undefined): boolean {
	return options?.restrictToolNames === true;
}
