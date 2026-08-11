import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seam: agents/poteto-agent.md
 *
 * Independent source of truth: orchestrate.md's sub-coordinator spawning
 * contract — lowercase OMP `task` with `agent: "poteto-agent"` (plus `hub`)
 * for durable background sub-coordinators. Discovery only activates native
 * `task` for further spawning when packaged agent frontmatter declares
 * `spawns: "*"` (OMP AgentDefinition: `spawns?: string[] | "*"`).
 *
 * Boundary guard (do not duplicate here): pstack_task programmatic
 * AgentDefinitions intentionally omit `spawns` so executor leaves empty
 * spawnsEnv and does not auto-add recursive `task`. That contract lives in
 * `tests/runtime-extension.test.ts` ("every AgentDefinition passed to raw
 * runSubprocess omits tools and spawns…") via
 * `preservesStandardNativeToolsWithoutRecursion`. This suite only pins the
 * packaged markdown agent seam; it must not weaken or restate that runtime
 * RED, and it must not assert against `src/pstack-task.ts` source text.
 */

const ROOT = join(import.meta.dir, "..");
const POTETO_AGENT_PATH = join(ROOT, "agents", "poteto-agent.md");

type Frontmatter = Record<string, string>;

function parseAgentFrontmatter(content: string): Frontmatter {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) {
		throw new Error("agents/poteto-agent.md is missing YAML frontmatter delimited by ---");
	}
	const fields: Frontmatter = {};
	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line
			.slice(idx + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		fields[key] = value;
	}
	return fields;
}

describe("packaged poteto-agent spawn contract", () => {
	test('agents/poteto-agent.md frontmatter declares spawns: "*" for orchestrate sub-coordinator task spawning', () => {
		expect(existsSync(POTETO_AGENT_PATH)).toBe(true);
		const body = readFileSync(POTETO_AGENT_PATH, "utf8");
		const frontmatter = parseAgentFrontmatter(body);

		expect(frontmatter.name).toBe("poteto-agent");
		// Required for direct lowercase `task` with agent:"poteto-agent".
		expect(frontmatter.spawns).toBe("*");
	});
});
