import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seams (packaged role-selector consumers):
 * - skills/poteto-mode/SKILL.md
 * - skills/arena/SKILL.md
 * - skills/interrogate/SKILL.md
 * - skills/swarm/SKILL.md
 * - skills/poteto-mode/references/plan.md
 *
 * Independent source of truth: clean active-profile model routing.
 * No consumer may mention the hardcoded default-profile path
 * `~/.omp/agent/rules/pstack-models.md`. Each must consume role
 * selectors from the active always-applied pstack model rule already
 * present in the OMP system prompt, or explicitly resolve active
 * agent_dir via `omp config path`, and fall back to `auto` when
 * absent. Assert every known consumer in one test so a single stale
 * default-path caller fails the suite.
 */

const ROOT = join(import.meta.dir, "..");

const ROLE_SELECTOR_CONSUMERS = [
	"skills/poteto-mode/SKILL.md",
	"skills/arena/SKILL.md",
	"skills/interrogate/SKILL.md",
	"skills/swarm/SKILL.md",
	"skills/poteto-mode/references/plan.md",
] as const;

/** Hardcoded default-profile rule path — forbidden in every consumer. */
const HARDCODED_DEFAULT_PROFILE_RULE = "~/.omp/agent/rules/pstack-models.md";

/**
 * Consume selectors from the always-applied rule already injected into
 * the OMP system prompt (preferred for read-only consumers).
 */
const ACTIVE_RULE_IN_SYSTEM_PROMPT =
	/(?:active\s+)?always-applied(?:\s+pstack)?(?:\s+model)?\s+rule[\s\S]{0,160}(?:system\s+prompt|OMP\s+system\s+prompt)|(?:system\s+prompt|OMP\s+system\s+prompt)[\s\S]{0,160}(?:always-applied|pstack-models|model\s+rule|role\s+selector)/i;

/**
 * Explicit active-profile resolution: derive agent_dir from
 * `omp config path` rather than assuming ~/.omp/agent.
 */
const EXPLICIT_AGENT_DIR_VIA_OMP_CONFIG_PATH =
	/(?:omp config path[\s\S]{0,200}\bagent_dir\b|\bagent_dir\b[\s\S]{0,200}omp config path)/i;

/** Absent role / selector / line falls back to auto. */
const AUTO_WHEN_ABSENT =
	/(?:\bauto\b[\s\S]{0,100}(?:when\s+(?:absent|missing|no\b)|(?:no|without)\s+(?:\w+\s+){0,6}(?:override|role|selector|line|entry|present)|fallback|default|otherwise)|(?:when\s+(?:absent|missing|no\b)|(?:no|without)\s+(?:\w+\s+){0,6}(?:override|role|selector|line|entry)|fallback|default|otherwise|when present)[\s\S]{0,100}\bauto\b)/i;

function readConsumer(relativePath: string): string {
	const absolute = join(ROOT, relativePath);
	expect(existsSync(absolute)).toBe(true);
	return readFileSync(absolute, "utf8");
}

function consumesActiveProfileSelectors(body: string): boolean {
	return (
		ACTIVE_RULE_IN_SYSTEM_PROMPT.test(body) ||
		EXPLICIT_AGENT_DIR_VIA_OMP_CONFIG_PATH.test(body)
	);
}

describe("packaged role-selector consumer active-profile contracts", () => {
	test("every known consumer rejects hardcoded default-profile pstack-models paths and consumes active-profile selectors with auto fallback", () => {
		const violations: string[] = [];

		for (const relativePath of ROLE_SELECTOR_CONSUMERS) {
			const body = readConsumer(relativePath);

			if (body.includes(HARDCODED_DEFAULT_PROFILE_RULE)) {
				violations.push(
					`${relativePath}: still mentions ${HARDCODED_DEFAULT_PROFILE_RULE}`,
				);
			}

			if (!consumesActiveProfileSelectors(body)) {
				violations.push(
					`${relativePath}: must consume role selectors from the active always-applied pstack model rule in the OMP system prompt, or resolve active agent_dir via \`omp config path\``,
				);
			}

			if (!AUTO_WHEN_ABSENT.test(body)) {
				violations.push(
					`${relativePath}: must fall back to \`auto\` when a role selector is absent`,
				);
			}
		}

		expect(violations).toEqual([]);
	});
});
