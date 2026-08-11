import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seam: skills/setup-pstack/SKILL.md
 *
 * Independent source of truth: OMP profile-aware config layout.
 * Active agent_dir comes from `omp config path` (respecting --profile /
 * OMP_PROFILE). Model-rule load/write/replace/confirm must use
 * `<agent_dir>/rules/pstack-models.md`, not a hardcoded universal
 * `~/.omp/agent` path.
 */

const ROOT = join(import.meta.dir, "..");
const SETUP_PSTACK = join(ROOT, "skills", "setup-pstack", "SKILL.md");

function readSeam(): string {
	expect(existsSync(SETUP_PSTACK)).toBe(true);
	return readFileSync(SETUP_PSTACK, "utf8");
}

/** Hardcoded home agent path presented as the active location. */
const UNIVERSAL_HOME_AGENT =
	/(?:^|[^/\w])~\/\.omp\/agent(?:\/rules(?:\/pstack-models\.md)?)?(?=[^\w./-]|$)/gm;

function unlabeledUniversalHomeAgentMentions(body: string): string[] {
	const hits: string[] = [];
	for (const match of body.matchAll(UNIVERSAL_HOME_AGENT)) {
		const index = match.index ?? 0;
		const window = body.slice(Math.max(0, index - 120), index + match[0].length + 120);
		const labeledDefault =
			/default(?:\s+profile)?|without\s+(?:--|OMP_)?profile|when\s+no\s+profile|fallback\s+default/i.test(
				window,
			);
		if (!labeledDefault) hits.push(match[0].trim());
	}
	return hits;
}

describe("setup-pstack profile-aware agent_dir contracts", () => {
	test("resolves active agent_dir via omp config path and binds pstack-models.md to that derived path for load/write/confirm", () => {
		const body = readSeam();

		expect(body).toContain("omp config path");
		expect(body).toMatch(/--profile|OMP_PROFILE/);
		expect(body).toMatch(
			/\bagent_dir\b[\s\S]{0,200}omp config path|omp config path[\s\S]{0,200}\bagent_dir\b/i,
		);
		expect(body).toMatch(
			/(?:\$\{?agent_dir\}?|<agent_dir>|agent_dir)\s*\/\s*rules\/pstack-models\.md/i,
		);

		// Load current state, write/replace, and confirmation must all speak
		// in terms of the derived path — not only one step.
		expect(body).toMatch(
			/(?:load|read|if[\s\S]{0,40}exists)[\s\S]{0,160}(?:\$\{?agent_dir\}?|<agent_dir>|agent_dir)\s*\/\s*rules\/pstack-models\.md|(?:\$\{?agent_dir\}?|<agent_dir>|agent_dir)\s*\/\s*rules\/pstack-models\.md[\s\S]{0,160}(?:load|read|exists|current)/i,
		);
		expect(body).toMatch(
			/(?:write|overwrite|create|replace|atomic)[\s\S]{0,200}(?:\$\{?agent_dir\}?|<agent_dir>|agent_dir)\s*\/\s*rules\/pstack-models\.md|(?:\$\{?agent_dir\}?|<agent_dir>|agent_dir)\s*\/\s*rules\/pstack-models\.md[\s\S]{0,200}(?:write|overwrite|create|replace|atomic)/i,
		);
		expect(body).toMatch(
			/(?:confirm|tell the user|exact path)[\s\S]{0,200}(?:\$\{?agent_dir\}?|<agent_dir>|agent_dir|omp config path)|(?:\$\{?agent_dir\}?|<agent_dir>|agent_dir)\s*\/\s*rules\/pstack-models\.md[\s\S]{0,160}(?:confirm|tell the user|written)/i,
		);

		expect(unlabeledUniversalHomeAgentMentions(body)).toEqual([]);
	});
});
