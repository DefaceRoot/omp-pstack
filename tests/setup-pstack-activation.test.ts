import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seam:
 * - docs/guide/01-setup.md
 *
 * Independent source of truth: writing `<agent_dir>/rules/pstack-models.md`
 * does not mean `pstack_task` reads that file. The active always-applied
 * pstack model rule is loaded into a new session's system prompt, and
 * routed skills pass selected model overrides to `pstack_task`. Changed
 * routing applies only after a new OMP session; `/reload-plugins` is not
 * sufficient — OMP 17.2.13 does not refresh active rules. Setup must not
 * promise an immediate read or a direct tool read of the rule file.
 *
 * Preserved skill checks (skills/setup-pstack/SKILL.md) still pin
 * new-session-only and `/reload-plugins`-insufficient wording there.
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

/**
 * False claim that pstack-models.md / the generated model rule is read by
 * `pstack_task` or otherwise read directly by the tool.
 */
const PSTACK_MODELS_READ_DIRECTLY_BY_TOOL =
	/(?:pstack-models\.md|generated rule|(?:model|pstack)\s+rule)[\s\S]{0,100}(?:read by\s+`?pstack_task`?|read\s+directly\s+by\s+(?:the\s+)?(?:`?pstack_task`?\s+)?tool)|`?pstack_task`?\s+reads?\s+(?:(?:the\s+)?(?:generated\s+)?(?:(?:pstack|model)\s+)?rule|pstack-models\.md|it\s+directly)/i;

/**
 * Guide must say the active always-applied pstack model rule is loaded
 * into a new session's system prompt.
 */
const ACTIVE_RULE_LOADED_INTO_NEW_SESSION_SYSTEM_PROMPT =
	/(?:active\s+)?always-applied(?:\s+pstack)?(?:\s+model)?\s+rule[\s\S]{0,200}(?:loaded|injected)\s+into\s+(?:a\s+)?new\s+session(?:'s)?\s+system\s+prompt|(?:loaded|injected)\s+into\s+(?:a\s+)?new\s+session(?:'s)?\s+system\s+prompt[\s\S]{0,200}(?:active\s+)?always-applied(?:\s+pstack)?(?:\s+model)?\s+rule/i;

/**
 * Guide must say routed skills pass selected model overrides to pstack_task.
 */
const ROUTED_SKILLS_PASS_MODEL_OVERRIDES =
	/routed\s+skills?[\s\S]{0,160}pass(?:es|ing)?\s+(?:selected\s+)?model\s+overrides?\s+to\s+`?pstack_task`?/i;

describe("setup-pstack model-rule activation contracts", () => {
	test("setup guide forbids pstack_task direct-read of pstack-models.md, requires system-prompt load plus routed skill model overrides, and preserves new-session-only /reload-plugins-insufficient activation", () => {
		const skill = readSeam(SETUP_PSTACK);
		const guide = readSeam(SETUP_GUIDE);

		expect(skill).not.toMatch(IMMEDIATE_PSTACK_TASK_READ);
		expect(guide).not.toMatch(IMMEDIATE_PSTACK_TASK_READ);

		expect(skill).not.toMatch(RELOAD_PLUGINS_AS_SUFFICIENT);
		expect(guide).not.toMatch(RELOAD_PLUGINS_AS_SUFFICIENT);

		expect(skill).toMatch(MODEL_RULE_NEW_OMP_SESSION);
		expect(guide).toMatch(MODEL_RULE_NEW_OMP_SESSION);

		// Focused guide seam: reject stale "read by pstack_task" / direct-tool-read
		// claim (docs/guide/01-setup.md line 23) and require the real load path.
		expect(guide).not.toMatch(PSTACK_MODELS_READ_DIRECTLY_BY_TOOL);
		expect(guide).toMatch(ACTIVE_RULE_LOADED_INTO_NEW_SESSION_SYSTEM_PROMPT);
		expect(guide).toMatch(ROUTED_SKILLS_PASS_MODEL_OVERRIDES);
	});
});
