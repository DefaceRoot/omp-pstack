/**
 * Child AgentDefinition capabilities required at the raw runSubprocess seam.
 *
 * A nonempty built-in tool whitelist must exclude recursive task launchers
 * (`task`, `pstack_task`) and declare empty `spawns` so a child extension reload
 * cannot recurse or reset task depth. Yield stays available via requireYieldTool
 * rather than being listed on the agent tools whitelist.
 */
export type AgentCapabilitySnapshot = {
	tools?: unknown;
	spawns?: unknown;
};

export function hasNonRecursiveBuiltInToolWhitelist(agent: AgentCapabilitySnapshot | null | undefined): boolean {
	if (!agent || !Array.isArray(agent.tools) || agent.tools.length === 0) return false;
	if (!agent.tools.every((tool) => typeof tool === "string" && tool.trim() !== "")) return false;
	if (agent.tools.includes("task") || agent.tools.includes("pstack_task")) return false;
	if (!Array.isArray(agent.spawns) || agent.spawns.length !== 0) return false;
	return true;
}
