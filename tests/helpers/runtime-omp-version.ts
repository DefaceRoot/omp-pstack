/**
 * OMP host version gate for omp-pstack extension initialization.
 *
 * Public seam: `ExtensionAPI.pi.VERSION` (coding-agent package index export).
 * Minimum supported host: 17.2.13 (ExecutorOptions enableMCP / preload / strict
 * schema surface required by pstack_task).
 */
export const MIN_OMP_CODING_AGENT_VERSION = "17.2.13";

export function parseSemverTriple(version: unknown): [number, number, number] | null {
	if (typeof version !== "string") return null;
	const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when VERSION is a semver string >= 17.2.13. */
export function meetsMinOmpCodingAgentVersion(version: unknown): boolean {
	const parsed = parseSemverTriple(version);
	const min = parseSemverTriple(MIN_OMP_CODING_AGENT_VERSION);
	if (!parsed || !min) return false;
	for (let i = 0; i < 3; i++) {
		if (parsed[i]! > min[i]!) return true;
		if (parsed[i]! < min[i]!) return false;
	}
	return true;
}
