import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seams:
 * - skills/setup-pstack/SKILL.md (installed /setup-pstack)
 * - docs/guide/01-setup.md
 *
 * Independent source of truth: writing `<agent_dir>/rules/pstack-models.md`
 * does not activate changed model routing for new `pstack_task` calls until
 * the user starts a new OMP session. `/reload-plugins` is not sufficient —
 * OMP 17.2.13 does not refresh active rules. Setup must instruct that
 * new-session activation step and must not promise an immediate read.
 */

const ROOT = join(import.meta.dir, "..");
const SETUP_PSTACK = join(ROOT, "skills", "setup-pstack", "SKILL.md");
const SETUP_GUIDE = join(ROOT, "docs", "guide", "01-setup.md");

function readSeam(path: string): string {
	expect(existsSync(path)).toBe(true);
	return readFileSync(path, "utf8");
}

/** False promise that new/subsequent pstack_task calls pick up the rule immediately. */
const IMMEDIATE_PSTACK_TASK_READ =
	/(?:new|subsequent)\s+`?pstack_task`?\s+calls\s+(?:read\s+it\s+immediately|immediately)|(?:available|read)\s+(?:to\s+subsequent\s+`?pstack_task`?\s+calls\s+)?immediately/i;

/**
 * After writing the model rule, instruct a new OMP session before relying
 * on changed model routing — not install-only fresh-session wording.
 */
const MODEL_RULE_NEW_OMP_SESSION =
	/(?:pstack-models\.md|model rule|model routing|written)[\s\S]{0,320}(?:(?:new|fresh)\s+OMP\s+session)|(?:(?:new|fresh)\s+OMP\s+session)[\s\S]{0,320}(?:model routing|pstack_task|pstack-models\.md|relying|before|applies)/i;

/**
 * Stale guidance that presents `/reload-plugins` as sufficient to activate
 * changed model routing — alone or as an alternative to a new session.
 * Mentions that explicitly deny sufficiency (does not refresh / not enough)
 * are allowed. Optional markdown backticks around the slash command are
 * accepted so prose and inline code both match.
 */
const RELOAD_PLUGINS_AS_SUFFICIENT =
	/(?:run\s+)?`?\/reload-plugins`?\s+or\s+(?:start\s+)?a\s+new\s+OMP\s+session|(?<!(?:do\s+not|don't|never)\s+)(?<!(?:not\s+(?:enough|sufficient)\s+to\s+))(?:must\s+)?run\s+`?\/reload-plugins`?\b/i;

describe("setup-pstack model-rule activation contracts", () => {
	test("setup skill and guide reject immediate-read and /reload-plugins-sufficient claims and require a new OMP session before changed model routing applies", () => {
		const skill = readSeam(SETUP_PSTACK);
		const guide = readSeam(SETUP_GUIDE);

		expect(skill).not.toMatch(IMMEDIATE_PSTACK_TASK_READ);
		expect(guide).not.toMatch(IMMEDIATE_PSTACK_TASK_READ);

		expect(skill).not.toMatch(RELOAD_PLUGINS_AS_SUFFICIENT);
		expect(guide).not.toMatch(RELOAD_PLUGINS_AS_SUFFICIENT);

		expect(skill).toMatch(MODEL_RULE_NEW_OMP_SESSION);
		expect(guide).toMatch(MODEL_RULE_NEW_OMP_SESSION);
	});
});
