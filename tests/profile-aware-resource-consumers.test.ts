import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seams (transcript consumers):
 * - skills/automate-me/SKILL.md
 * - skills/recall/SKILL.md
 * - skills/reflect/SKILL.md
 * - skills/show-me-your-work/SKILL.md
 * - skills/poteto-mode/playbooks/eval.md
 * - skills/poteto-mode/playbooks/session-pickup.md
 *
 * Public seams (user-skill consumers):
 * - skills/automate-me/SKILL.md
 * - skills/poteto-mode/playbooks/authoring-a-skill.md
 * - skills/reflect/references/divergent-reviewer.md
 * - skills/reflect/references/judgment-reviewer.md
 * - skills/reflect/references/tooling-reviewer.md
 *
 * Public seams (reflect reviewer plugin-evidence consumers):
 * - skills/reflect/references/divergent-reviewer.md
 * - skills/reflect/references/judgment-reviewer.md
 * - skills/reflect/references/tooling-reviewer.md
 *
 * Public seam (automate-me update-mode edit start):
 * - skills/automate-me/SKILL.md
 *
 * Independent source of truth: OMP profile-aware resource layout.
 * Prefer an explicit current session / `history://` (or `agent://`) path.
 * Filesystem fallback resolves active `agent_dir` via `omp config path`,
 * considers the profile-matched XDG data sessions root
 * `$XDG_DATA_HOME/omp/profiles/<profile>/sessions` when applicable, and
 * never reads default-profile sessions (`~/.omp/agent/sessions` or
 * `$XDG_DATA_HOME/omp/sessions`) under a named profile.
 * Default-profile XDG: when `XDG_DATA_HOME` is explicitly set, the
 * applicable omp data root already exists, and the normalized profile is
 * default (unset / trimmed empty / literal `default`), also consider
 * `$XDG_DATA_HOME/omp/sessions`. That additional XDG session root is
 * eligible only on linux/darwin AND when active `agent_dir` is the
 * profile-derived default (`isDefault`). With default profile plus a
 * custom `PI_CODING_AGENT_DIR`, only `<custom-agent_dir>/sessions` may
 * be scanned even if `$XDG_DATA_HOME/omp` exists; on Windows OMP ignores
 * the XDG root. Named profiles use only the profile-matched root. Do
 * not invent `$HOME/.local/share` when `XDG_DATA_HOME` is unset.
 * User-authored skill discovery/write/evidence uses `<agent_dir>/skills`
 * resolved the same way — never `~/.omp/agent/skills`. Project
 * `.omp/skills` remains valid. Reflect reviewers must not assume any
 * fixed/default `~/.omp/plugins` root (OMP 17.2.13 `getPluginsDir` is
 * profile/XDG-aware). Plugin skill evidence uses actual transcript /
 * `skill://` SKILL.md paths, or resolves the active `plugins_directory`
 * via `omp plugin doctor` (profile/XDG-aware) — never a default-only
 * plugins assumption. automate-me update mode uses Git history only when
 * the selected skill is tracked in the current project repository; for
 * user-authored / otherwise untracked active-profile skills under
 * `<agent_dir>/skills`, use a portable file mtime as the edit start
 * point, and stop/report if neither timestamp is readable. An
 * unconditional `git log -1 --format=%cI <path>` breaks the newly
 * supported user-skill path. Assert every known consumer in one focused
 * suite so a single stale default-path caller fails RED.
 */

const ROOT = join(import.meta.dir, "..");

const TRANSCRIPT_CONSUMERS = [
	"skills/automate-me/SKILL.md",
	"skills/recall/SKILL.md",
	"skills/reflect/SKILL.md",
	"skills/show-me-your-work/SKILL.md",
	"skills/poteto-mode/playbooks/eval.md",
	"skills/poteto-mode/playbooks/session-pickup.md",
] as const;

type UserSkillConsumer = {
	path: string;
	/** Project-local authored skills remain valid. */
	requiresProjectSkills: boolean;
};

const USER_SKILL_CONSUMERS: readonly UserSkillConsumer[] = [
	{
		path: "skills/automate-me/SKILL.md",
		requiresProjectSkills: true,
	},
	{
		path: "skills/poteto-mode/playbooks/authoring-a-skill.md",
		requiresProjectSkills: true,
	},
	{
		path: "skills/reflect/references/divergent-reviewer.md",
		requiresProjectSkills: true,
	},
	{
		path: "skills/reflect/references/judgment-reviewer.md",
		requiresProjectSkills: true,
	},
	{
		path: "skills/reflect/references/tooling-reviewer.md",
		requiresProjectSkills: true,
	},
];

const REFLECT_REVIEWER_PLUGIN_CONSUMERS = [
	"skills/reflect/references/divergent-reviewer.md",
	"skills/reflect/references/judgment-reviewer.md",
	"skills/reflect/references/tooling-reviewer.md",
] as const;

const AUTOMATE_ME = "skills/automate-me/SKILL.md";

/** Hardcoded default-profile session root — forbidden as an active location. */
const HARDCODED_DEFAULT_SESSIONS = "~/.omp/agent/sessions";

/** Hardcoded default-profile user-skills root — forbidden. */
const HARDCODED_DEFAULT_SKILLS = "~/.omp/agent/skills";

/**
 * Any fixed/default plugins root under `~/.omp/plugins` — forbidden.
 * OMP 17.2.13 `getPluginsDir` is profile/XDG-aware; do not require or
 * assume the default-profile path (with or without `/node_modules`).
 */
const HARDCODED_DEFAULT_PLUGINS = /~\/\.omp\/plugins(?:\/|$)/;

/**
 * Default-profile XDG sessions root (`$XDG_DATA_HOME/omp/sessions`). Required
 * only when gated to an explicit `XDG_DATA_HOME`, an existing applicable omp
 * root, and a normalized default profile — never under a named profile.
 */
const DEFAULT_PROFILE_XDG_SESSIONS = /\$XDG_DATA_HOME\/omp\/sessions\b/;

/**
 * Gated default-profile XDG use: `$XDG_DATA_HOME/omp/sessions` tied to
 * XDG_DATA_HOME explicitly set, an applicable omp root that exists, and a
 * normalized default profile (unset / trimmed empty / literal `default`).
 */
const DEFAULT_PROFILE_XDG_GATED =
	/\$XDG_DATA_HOME\/omp\/sessions[\s\S]{0,500}(?:explicitly\s+set|XDG_DATA_HOME[\s\S]{0,80}set)[\s\S]{0,300}(?:omp(?:\s+data)?\s+root[\s\S]{0,80}exists|exists[\s\S]{0,80}omp(?:\s+data)?\s+root)[\s\S]{0,300}(?:default(?:\s+profile)?|unset|trimmed\s+empty|literal\s+`?default`?)|(?:explicitly\s+set|XDG_DATA_HOME[\s\S]{0,80}set)[\s\S]{0,300}(?:omp(?:\s+data)?\s+root[\s\S]{0,80}exists|exists[\s\S]{0,80}omp(?:\s+data)?\s+root)[\s\S]{0,300}(?:default(?:\s+profile)?|unset|trimmed\s+empty|literal\s+`?default`?)[\s\S]{0,300}\$XDG_DATA_HOME\/omp\/sessions|(?:default(?:\s+profile)?|unset|trimmed\s+empty|literal\s+`?default`?)[\s\S]{0,300}(?:explicitly\s+set|XDG_DATA_HOME[\s\S]{0,80}set)[\s\S]{0,300}(?:omp(?:\s+data)?\s+root[\s\S]{0,80}exists|exists[\s\S]{0,80}omp(?:\s+data)?\s+root)[\s\S]{0,300}\$XDG_DATA_HOME\/omp\/sessions|(?:default(?:\s+profile)?|unset|trimmed\s+empty|literal\s+`?default`?)[\s\S]{0,300}\$XDG_DATA_HOME\/omp\/sessions[\s\S]{0,300}(?:explicitly\s+set|XDG_DATA_HOME[\s\S]{0,80}set)[\s\S]{0,300}(?:omp(?:\s+data)?\s+root[\s\S]{0,80}exists|exists[\s\S]{0,80}omp(?:\s+data)?\s+root)/i;

/**
 * Invented platform XDG fallback when `XDG_DATA_HOME` is unset — forbidden.
 * OMP only adopts XDG when the env var is explicitly set.
 */
const INVENTED_XDG_FALLBACK =
	/\$HOME\/\.local\/share|~\/\.local\/share|platform XDG data default|XDG data default when (?:the )?(?:variable|XDG_DATA_HOME) is unset|using the platform XDG(?: data)? default when (?:the )?variable is unset/i;

/**
 * DirResolver: additional XDG session roots are only considered on
 * linux/darwin (Windows ignores XDG).
 */
const XDG_SESSIONS_LINUX_OR_DARWIN =
	/(?:linux|darwin)[\s\S]{0,160}(?:XDG|xdg)|(?:XDG|xdg)[\s\S]{0,160}(?:linux|darwin)|(?:only|solely|just)\s+on\s+(?:linux(?:\/|,?\s*|\s+and\s+)darwin|darwin(?:\/|,?\s*|\s+and\s+)linux)|supported platforms?[\s\S]{0,80}(?:linux|darwin)/i;

/**
 * DirResolver `isDefault`: XDG adoption requires active agent_dir to be the
 * profile-derived default agent directory — not a custom override.
 */
const XDG_REQUIRES_PROFILE_DERIVED_DEFAULT_AGENT_DIR =
	/(?:isDefault|profile-derived\s+default|agent_dir[\s\S]{0,80}(?:equals|is\s+the|matches)[\s\S]{0,80}(?:profile-derived|default\s+agent)|(?:only|solely)\s+when[\s\S]{0,120}(?:profile-derived\s+default|isDefault|agent_dir[\s\S]{0,60}default))/i;

/**
 * Custom `PI_CODING_AGENT_DIR` on the default profile disables the additional
 * XDG session root — scan only `<custom-agent_dir>/sessions`.
 */
const CUSTOM_PI_CODING_AGENT_DIR_SKIPS_XDG =
	/(?:PI_CODING_AGENT_DIR|custom\s+agent_dir|agentDirOverride)[\s\S]{0,220}(?:(?:only|solely)\s+(?:search|scan|use)|no\s+XDG|without\s+XDG|skip(?:s|ping)?\s+XDG|not[\s\S]{0,40}XDG)|(?:(?:only|solely)\s+(?:search|scan|use)|no\s+XDG|without\s+XDG|skip(?:s|ping)?\s+XDG)[\s\S]{0,220}(?:PI_CODING_AGENT_DIR|custom\s+agent_dir)/i;

/** Windows must ignore the additional XDG sessions root. */
const WINDOWS_IGNORES_XDG_SESSIONS =
	/(?:windows|win32)[\s\S]{0,120}(?:ignore[sd]?|does\s+not|don't|do\s+not|never)[\s\S]{0,80}XDG|(?:ignore[sd]?|does\s+not|don't|do\s+not|never)[\s\S]{0,80}XDG[\s\S]{0,120}(?:windows|win32)/i;

/** Prefer an explicit current session / history / agent handoff path. */
const PREFER_EXPLICIT_SESSION_OR_HISTORY =
	/(?:current\s+(?:OMP\s+)?session\s+path|explicit\s+OMP\s+transcript\s+path|history:\/\/|agent:\/\/)/i;

/**
 * Filesystem fallback resolves active agent_dir from `omp config path`
 * rather than assuming ~/.omp/agent.
 */
const AGENT_DIR_VIA_OMP_CONFIG_PATH =
	/(?:omp config path[\s\S]{0,220}\bagent_dir\b|\bagent_dir\b[\s\S]{0,220}omp config path)/i;

/** Sessions discovered under the derived agent_dir. */
const AGENT_DIR_SESSIONS =
	/(?:\$\{?agent_dir\}?|<agent_dir>|\bagent_dir\b)\s*\/\s*sessions/i;

/**
 * Profile-matched XDG data sessions root when applicable
 * (`$XDG_DATA_HOME/omp/profiles/<profile>/sessions`).
 */
const PROFILE_MATCHED_XDG_SESSIONS =
	/(?:\$XDG_DATA_HOME|XDG_DATA_HOME)[\s\S]{0,40}omp\/profiles\/(?:<profile>|<name>|\$\{?profile\}?|\{profile\})\/sessions|omp\/profiles\/(?:<profile>|<name>|\$\{?profile\}?|\{profile\}|[^/\s]+)\/sessions/i;

/** Named-profile scans must not inherit default-profile session roots. */
const NO_DEFAULT_PROFILE_SESSION_LEAK =
	/(?:never|do\s+not|don't|without)[\s\S]{0,120}(?:default-profile|default\s+profile)[\s\S]{0,80}sessions|(?:default-profile|default\s+profile)[\s\S]{0,80}sessions[\s\S]{0,120}(?:never|do\s+not|don't|leak|under\s+a\s+named)/i;

/** User-authored skills under the derived agent_dir. */
const AGENT_DIR_SKILLS =
	/(?:\$\{?agent_dir\}?|<agent_dir>|\bagent_dir\b)\s*\/\s*skills/i;

/** Project-local skill root remains valid. */
const PROJECT_SKILLS = /\.omp\/skills/;

/**
 * Plugin skill evidence from actual transcript / `skill://` SKILL.md paths
 * (not an invented fixed plugins root).
 */
const PLUGIN_EVIDENCE_FROM_TRANSCRIPT =
	/(?:actual\s+paths?|paths?\s+recorded|skill:\/\/\s*paths?\s+recorded|recorded\s+in\s+(?:the\s+)?transcript)[\s\S]{0,120}(?:skill:\/\/|SKILL\.md)|(?:skill:\/\/|SKILL\.md)[\s\S]{0,120}(?:actual\s+paths?|paths?\s+recorded|recorded\s+in\s+(?:the\s+)?transcript)|(?:actual\s+(?:transcript\s+)?(?:paths?|skill:\/\/)|skill:\/\/\s*paths?\s+recorded\s+in\s+(?:the\s+)?transcript)/i;

/**
 * Active profile/XDG-aware plugins directory from `omp plugin doctor`'s
 * `plugins_directory` check — never a hardcoded default-only root.
 */
const PLUGIN_DIR_VIA_OMP_PLUGIN_DOCTOR =
	/(?:omp plugin doctor[\s\S]{0,220}plugins_directory|plugins_directory[\s\S]{0,220}omp plugin doctor)/i;

/** Named/active profile must not inherit a default-only plugins root. */
const NO_DEFAULT_ONLY_PLUGINS_ASSUMPTION =
	/(?:never|do\s+not|don't|without)[\s\S]{0,120}(?:default(?:-|\s+)?(?:profile|only)|fixed|hardcoded)[\s\S]{0,80}plugins|(?:default(?:-|\s+)?(?:profile|only)|fixed|hardcoded)[\s\S]{0,80}plugins[\s\S]{0,120}(?:never|do\s+not|don't|forbid|avoid)|(?:profile|XDG)[\s\S]{0,80}aware[\s\S]{0,120}plugins_directory|plugins_directory[\s\S]{0,120}(?:profile|XDG)[\s\S]{0,40}aware/i;

/**
 * Unconditional Git committer-date edit start — forbidden. Breaks
 * user-authored / untracked active-profile skills under <agent_dir>/skills.
 */
const UNCONDITIONAL_GIT_LOG_EDIT_START =
	/git log -1 --format=%cI <path>|`git log -1 --format=%cI <path>`/;

/**
 * Git history is valid only when the selected skill is tracked in the
 * current project repository.
 */
const GIT_HISTORY_ONLY_WHEN_TRACKED =
	/(?:git(?:\s+log|\s+history)|%cI)[\s\S]{0,160}(?:tracked|in\s+(?:the\s+)?(?:current\s+)?(?:project\s+)?(?:git\s+)?(?:repo|repository))|(?:tracked|in\s+(?:the\s+)?(?:current\s+)?(?:project\s+)?(?:git\s+)?(?:repo|repository))[\s\S]{0,160}(?:git(?:\s+log|\s+history)|%cI|committer)/i;

/**
 * Portable filesystem mtime for user-authored / untracked skills under
 * the active <agent_dir>/skills root.
 */
const PORTABLE_MTIME_FOR_USER_SKILLS =
	/(?:(?:portable\s+)?(?:file\s+)?mtime|modification\s+time)[\s\S]{0,200}(?:\$\{?agent_dir\}?|<agent_dir>|\bagent_dir\b)\s*\/\s*skills|(?:\$\{?agent_dir\}?|<agent_dir>|\bagent_dir\b)\s*\/\s*skills[\s\S]{0,200}(?:(?:portable\s+)?(?:file\s+)?mtime|modification\s+time)|(?:user-authored|untracked)[\s\S]{0,200}(?:(?:portable\s+)?(?:file\s+)?mtime|modification\s+time)/i;

/** Stop / report when neither Git nor mtime timestamp is readable. */
const STOP_IF_NEITHER_TIMESTAMP_READABLE =
	/(?:stop|abort|halt|report|fail|refuse)[\s\S]{0,160}(?:neither|no\s+(?:readable\s+)?timestamp|both\s+(?:timestamps?\s+)?(?:unreadable|missing|unavailable)|(?:mtime|git)[\s\S]{0,80}(?:and|nor)[\s\S]{0,80}(?:mtime|git))|(?:neither|no\s+(?:readable\s+)?timestamp|both\s+(?:timestamps?\s+)?(?:unreadable|missing|unavailable))[\s\S]{0,160}(?:stop|abort|halt|report|fail|refuse)/i;

function readConsumer(relativePath: string): string {
	const absolute = join(ROOT, relativePath);
	expect(existsSync(absolute)).toBe(true);
	return readFileSync(absolute, "utf8");
}

function resolvesPluginEvidenceWithoutDefaultOnly(body: string): boolean {
	return (
		PLUGIN_EVIDENCE_FROM_TRANSCRIPT.test(body) ||
		PLUGIN_DIR_VIA_OMP_PLUGIN_DOCTOR.test(body)
	);
}

describe("profile-aware transcript and user-skill consumer contracts", () => {
	test("every transcript consumer prefers explicit session/history paths, resolves filesystem fallback via omp config path + profile-matched XDG, and forbids hardcoded default session roots", () => {
		const violations: string[] = [];

		for (const relativePath of TRANSCRIPT_CONSUMERS) {
			const body = readConsumer(relativePath);

			if (body.includes(HARDCODED_DEFAULT_SESSIONS)) {
				violations.push(
					`${relativePath}: still mentions ${HARDCODED_DEFAULT_SESSIONS}`,
				);
			}

			if (!PREFER_EXPLICIT_SESSION_OR_HISTORY.test(body)) {
				violations.push(
					`${relativePath}: must prefer an explicit current session path, history://, or agent:// handoff before filesystem discovery`,
				);
			}

			if (!AGENT_DIR_VIA_OMP_CONFIG_PATH.test(body)) {
				violations.push(
					`${relativePath}: filesystem fallback must resolve active agent_dir via \`omp config path\``,
				);
			}

			if (!AGENT_DIR_SESSIONS.test(body)) {
				violations.push(
					`${relativePath}: filesystem fallback must search <agent_dir>/sessions`,
				);
			}

			if (!PROFILE_MATCHED_XDG_SESSIONS.test(body)) {
				violations.push(
					`${relativePath}: must consider profile-matched XDG data sessions root \`$XDG_DATA_HOME/omp/profiles/<profile>/sessions\` when applicable`,
				);
			}

			if (!NO_DEFAULT_PROFILE_SESSION_LEAK.test(body)) {
				violations.push(
					`${relativePath}: must say named-profile discovery never reads default-profile sessions`,
				);
			}
		}

		expect(violations).toEqual([]);
	});

	test("every transcript consumer gates default-profile $XDG_DATA_HOME/omp/sessions, keeps named profiles on the profile-matched root only, and forbids invented ~/.local/share fallbacks", () => {
		const violations: string[] = [];

		for (const relativePath of TRANSCRIPT_CONSUMERS) {
			const body = readConsumer(relativePath);

			// Preserve active agent_dir + no profile leakage while tightening
			// default-profile XDG semantics.
			if (!AGENT_DIR_VIA_OMP_CONFIG_PATH.test(body)) {
				violations.push(
					`${relativePath}: must still resolve active agent_dir via \`omp config path\``,
				);
			}

			if (!AGENT_DIR_SESSIONS.test(body)) {
				violations.push(
					`${relativePath}: must still search <agent_dir>/sessions`,
				);
			}

			if (!PROFILE_MATCHED_XDG_SESSIONS.test(body)) {
				violations.push(
					`${relativePath}: named profiles must use only profile-matched \`$XDG_DATA_HOME/omp/profiles/<profile>/sessions\``,
				);
			}

			if (!NO_DEFAULT_PROFILE_SESSION_LEAK.test(body)) {
				violations.push(
					`${relativePath}: named-profile discovery must never read default-profile sessions`,
				);
			}

			if (!DEFAULT_PROFILE_XDG_SESSIONS.test(body)) {
				violations.push(
					`${relativePath}: must also consider \`$XDG_DATA_HOME/omp/sessions\` for the default profile`,
				);
			}

			if (!DEFAULT_PROFILE_XDG_GATED.test(body)) {
				violations.push(
					`${relativePath}: \`$XDG_DATA_HOME/omp/sessions\` must be gated to XDG_DATA_HOME explicitly set, applicable omp root exists, and normalized profile default (unset / trimmed empty / literal \`default\`)`,
				);
			}

			if (INVENTED_XDG_FALLBACK.test(body)) {
				violations.push(
					`${relativePath}: must not invent \`$HOME/.local/share\` / platform XDG defaults when XDG_DATA_HOME is unset`,
				);
			}
		}

		expect(violations).toEqual([]);
	});

	test("every transcript consumer gates additional XDG sessions to linux/darwin + profile-derived default agent_dir (isDefault), skips XDG under custom PI_CODING_AGENT_DIR, and ignores XDG on Windows", () => {
		const violations: string[] = [];

		for (const relativePath of TRANSCRIPT_CONSUMERS) {
			const body = readConsumer(relativePath);

			// Preserve prior normalized-profile / agent_dir / no-leakage contracts.
			if (!AGENT_DIR_VIA_OMP_CONFIG_PATH.test(body)) {
				violations.push(
					`${relativePath}: must still resolve active agent_dir via \`omp config path\``,
				);
			}

			if (!AGENT_DIR_SESSIONS.test(body)) {
				violations.push(
					`${relativePath}: must still search <agent_dir>/sessions`,
				);
			}

			if (!PROFILE_MATCHED_XDG_SESSIONS.test(body)) {
				violations.push(
					`${relativePath}: named profiles must still use profile-matched \`$XDG_DATA_HOME/omp/profiles/<profile>/sessions\``,
				);
			}

			if (!NO_DEFAULT_PROFILE_SESSION_LEAK.test(body)) {
				violations.push(
					`${relativePath}: named-profile discovery must still never read default-profile sessions`,
				);
			}

			if (!DEFAULT_PROFILE_XDG_SESSIONS.test(body)) {
				violations.push(
					`${relativePath}: must still mention \`$XDG_DATA_HOME/omp/sessions\` for eligible default-profile cases`,
				);
			}

			if (!XDG_SESSIONS_LINUX_OR_DARWIN.test(body)) {
				violations.push(
					`${relativePath}: additional XDG session root is eligible only on linux/darwin`,
				);
			}

			if (!XDG_REQUIRES_PROFILE_DERIVED_DEFAULT_AGENT_DIR.test(body)) {
				violations.push(
					`${relativePath}: additional XDG session root requires active agent_dir to be the profile-derived default (isDefault)`,
				);
			}

			if (!CUSTOM_PI_CODING_AGENT_DIR_SKIPS_XDG.test(body)) {
				violations.push(
					`${relativePath}: with default profile plus custom PI_CODING_AGENT_DIR, only <custom-agent_dir>/sessions may be scanned even if $XDG_DATA_HOME/omp exists`,
				);
			}

			if (!WINDOWS_IGNORES_XDG_SESSIONS.test(body)) {
				violations.push(
					`${relativePath}: on Windows OMP ignores the additional XDG sessions root`,
				);
			}
		}

		expect(violations).toEqual([]);
	});

	test("every user-skill consumer resolves <agent_dir>/skills via omp config path, forbids ~/.omp/agent/skills, and keeps project .omp/skills where relevant", () => {
		const violations: string[] = [];

		for (const consumer of USER_SKILL_CONSUMERS) {
			const body = readConsumer(consumer.path);

			if (body.includes(HARDCODED_DEFAULT_SKILLS)) {
				violations.push(
					`${consumer.path}: still mentions ${HARDCODED_DEFAULT_SKILLS}`,
				);
			}

			if (!AGENT_DIR_VIA_OMP_CONFIG_PATH.test(body)) {
				violations.push(
					`${consumer.path}: user-authored skills must resolve active agent_dir via \`omp config path\``,
				);
			}

			if (!AGENT_DIR_SKILLS.test(body)) {
				violations.push(
					`${consumer.path}: user-authored skill discovery/write/evidence must use <agent_dir>/skills`,
				);
			}

			if (consumer.requiresProjectSkills && !PROJECT_SKILLS.test(body)) {
				violations.push(
					`${consumer.path}: project .omp/skills must remain a valid skill root`,
				);
			}
		}

		expect(violations).toEqual([]);
	});

	test("every reflect reviewer forbids any fixed ~/.omp/plugins assumption, resolves plugin evidence via transcript skill:// SKILL.md paths or omp plugin doctor plugins_directory, and preserves project + <agent_dir>/skills", () => {
		const violations: string[] = [];

		for (const relativePath of REFLECT_REVIEWER_PLUGIN_CONSUMERS) {
			const body = readConsumer(relativePath);

			if (HARDCODED_DEFAULT_PLUGINS.test(body)) {
				violations.push(
					`${relativePath}: still assumes fixed/default ~/.omp/plugins (OMP getPluginsDir is profile/XDG-aware)`,
				);
			}

			if (!PROJECT_SKILLS.test(body)) {
				violations.push(
					`${relativePath}: project .omp/skills must remain a valid skill evidence root`,
				);
			}

			if (!AGENT_DIR_SKILLS.test(body)) {
				violations.push(
					`${relativePath}: active <agent_dir>/skills must remain a valid skill evidence root`,
				);
			}

			if (!AGENT_DIR_VIA_OMP_CONFIG_PATH.test(body)) {
				violations.push(
					`${relativePath}: must resolve active agent_dir via \`omp config path\` for user-authored skills`,
				);
			}

			if (!resolvesPluginEvidenceWithoutDefaultOnly(body)) {
				violations.push(
					`${relativePath}: plugin skill evidence must use actual transcript/skill:// SKILL.md paths, or resolve active plugins_directory via \`omp plugin doctor\` (profile/XDG-aware)`,
				);
			}

			if (!NO_DEFAULT_ONLY_PLUGINS_ASSUMPTION.test(body)) {
				violations.push(
					`${relativePath}: must not leak/assume a default-only plugins root; plugins_directory resolution must be profile/XDG-aware`,
				);
			}
		}

		expect(violations).toEqual([]);
	});

	test("automate-me update mode uses Git history only for project-tracked skills, portable mtime for untracked <agent_dir>/skills, and stops when neither timestamp is readable", () => {
		const violations: string[] = [];
		const body = readConsumer(AUTOMATE_ME);

		if (UNCONDITIONAL_GIT_LOG_EDIT_START.test(body)) {
			violations.push(
				`${AUTOMATE_ME}: still uses unconditional \`git log -1 --format=%cI <path>\`; that breaks user-authored / untracked active-profile skills under <agent_dir>/skills`,
			);
		}

		if (!GIT_HISTORY_ONLY_WHEN_TRACKED.test(body)) {
			violations.push(
				`${AUTOMATE_ME}: update mode must use Git history only when the selected skill is tracked in the current project repository`,
			);
		}

		if (!PORTABLE_MTIME_FOR_USER_SKILLS.test(body)) {
			violations.push(
				`${AUTOMATE_ME}: for user-authored / otherwise untracked active-profile skills under <agent_dir>/skills, update mode must use a portable file mtime as the edit start point`,
			);
		}

		if (!STOP_IF_NEITHER_TIMESTAMP_READABLE.test(body)) {
			violations.push(
				`${AUTOMATE_ME}: update mode must stop/report if neither Git nor mtime timestamp is readable`,
			);
		}

		expect(violations).toEqual([]);
	});
});
