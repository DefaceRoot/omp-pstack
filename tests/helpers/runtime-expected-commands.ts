/**
 * Canonical unprefixed slash-command names the runtime extension must register.
 * Direct skills = non-principle P-Stack skills (23 total, including poteto-mode).
 */
export const PSTACK_DIRECT_SKILL_COMMANDS = [
	"architect",
	"arena",
	"automate-me",
	"blast-radius",
	"bro",
	"create-verification-skill",
	"figure-it-out",
	"how",
	"interrogate",
	"maintain-verification-skill",
	"no-comments",
	"poteto-mode",
	"recall",
	"reflect",
	"setup-pstack",
	"show-me-your-work",
	"swarm",
	"tdd",
	"teach",
	"technical-writing",
	"typescript-best-practices",
	"unslop",
	"why",
] as const;

export const OTHER_PSTACK_DIRECT_SKILL_COMMANDS = PSTACK_DIRECT_SKILL_COMMANDS.filter(
	(name) => name !== "poteto-mode",
);

export const BUNDLED_TEAM_KIT_COMMANDS = ["deslop", "control-cli", "control-ui"] as const;

export const PSTACK_SESSION_COMMANDS = ["pstack-off", "pstack-status", "pstack-cleanup"] as const;

/** OMP analog of Cursor's ~/.cursor/rules/pstack-models.mdc */
export const PSTACK_MODEL_RULE_BASENAME = "pstack-models.md";

export const PSTACK_MODE_ENTRY_TYPE = "pstack-mode";
