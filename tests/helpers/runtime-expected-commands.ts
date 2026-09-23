/**
 * Canonical unprefixed slash-command names the runtime extension must register.
 *
 * poteto-mode plus the other 21 direct skills (22 directs). `/setup-pstack` is a
 * native session command, not a skill prompt.
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

export const PSTACK_SESSION_COMMANDS = ["pstack-off", "pstack-status", "setup-pstack", "pstack-cleanup"] as const;

export const LEGACY_MODEL_RULE_BASENAME = "pstack-models.md";

export const PSTACK_MODE_ENTRY_TYPE = "pstack-mode";
