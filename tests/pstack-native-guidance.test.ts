import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seams (text/instructions only):
 * - skills/poteto-mode/playbooks/orchestrate.md
 * - skills/poteto-mode/playbooks/worktree-cleanup.md
 * - automations/benny/README.md
 * - automations/benny/FOR_AGENTS.md
 * - automations/benny/skills/setup-benny/SKILL.md
 *
 * Independent source of truth: OMP orch store binding (`--store` / `ORCH_STORE`),
 * OMP `/goal set` wake (not a pstack "loop skill"), no Cursor user-state deletion,
 * and Benny as dormant/archive-only with no native scheduler — plugin enablement
 * only via the OMP-generated enable command, never hand-authored registry JSON.
 * FOR_AGENTS.md is an active agent entrypoint and must not teach runnable
 * copy/enable/list/automate/editor bootstrap.
 *
 * Worktree cleanup safety (worktree-cleanup.md): any tracked, untracked, or
 * ignored content needs exact paths and sizes shown plus explicit user
 * confirmation; never call untracked/ignored "throwaway" or disposable. Only
 * clean + merged + no-open-PR + not-in-use worktrees may auto-proceed. Default
 * removal is ordinary `git worktree remove -- <path>` with proper quoting; on
 * refuse or state change, stop and rerun audit / show current contents. Forbid
 * default `git worktree remove --force` and `rm -rf`; force only after a
 * separate fresh status and explicit destructive confirmation for exact paths.
 */

const ROOT = join(import.meta.dir, "..");

const ORCHESTRATE = join(
	ROOT,
	"skills",
	"poteto-mode",
	"playbooks",
	"orchestrate.md",
);
const WORKTREE_CLEANUP = join(
	ROOT,
	"skills",
	"poteto-mode",
	"playbooks",
	"worktree-cleanup.md",
);
const BENNY_README = join(ROOT, "automations", "benny", "README.md");
const BENNY_FOR_AGENTS = join(ROOT, "automations", "benny", "FOR_AGENTS.md");
const SETUP_BENNY = join(
	ROOT,
	"automations",
	"benny",
	"skills",
	"setup-benny",
	"SKILL.md",
);

const OMP_PLUGIN_ENABLE =
	"omp plugin enable @defaceroot/omp-pstack --scope project";

/** Backticked `orch <subcommand...>` examples; bare alias gloss `orch` is ignored. */
const ORCH_INVOCATION = /`orch\s+([^`]+)`/g;

/** Untracked/ignored/scratch must never be framed as throwaway, disposable, or safe to drop. */
const SCRATCH_THROWAWAY_OR_SAFE_DROP =
	/(?:scratch|untracked|ignored)[\s\S]{0,120}(?:throwaway|disposable|safe to drop)|(?:throwaway|disposable|safe to drop)[\s\S]{0,120}(?:scratch|untracked|ignored)/i;

/** Tracked/untracked/ignored (or wip/scratch) content needs exact paths, sizes, and confirmation. */
const EXACT_PATHS_SIZES_AND_CONFIRMATION =
	/(?:tracked|untracked|ignored|wip|scratch)[\s\S]{0,220}(?:exact paths?|paths?)[\s\S]{0,40}sizes?[\s\S]{0,160}(?:explicit )?(?:user )?confirmation|(?:exact paths?[\s\S]{0,40}sizes?|paths? and sizes?)[\s\S]{0,200}(?:explicit )?(?:user )?confirmation/i;

/** Auto-proceed only for clean + merged + no-open-PR + not-in-use. */
const AUTO_PROCEED_CLEAN_MERGED_NO_OPEN_PR_NOT_IN_USE =
	/clean[\s\S]{0,60}merged[\s\S]{0,60}(?:no[- ]open[- ]PR|no open PR)[\s\S]{0,60}(?:not[- ]in[- ]use|not in use)|(?:auto-proceed|proceeds?)[\s\S]{0,140}clean[\s\S]{0,80}merged[\s\S]{0,80}(?:no[- ]open[- ]PR|no open PR)[\s\S]{0,80}(?:not[- ]in[- ]use|not in use)/i;

/** Ordinary default remove uses end-of-options `--` before the path. */
const ORDINARY_WORKTREE_REMOVE = /git worktree remove -- /;

/** Paths in remove commands must be quoted / quoting called out. */
const PATH_QUOTING =
	/quot(?:e|ed|ing)[\s\S]{0,80}(?:path|worktree)|(?:path|worktree)[\s\S]{0,80}quot(?:e|ed|ing)|proper quot(?:e|ing)/i;

/** Default prune recipe must not prescribe `--force`. */
const DEFAULT_FORCE_REMOVE =
	/(?:Per path|Prune the confirmed set|confirmed set)[\s\S]{0,100}git worktree remove --force/i;

/** `rm -rf` is never the cleanup tool. */
const RM_RF = /\brm\s+-rf\b/;

/** On refuse or state change: stop and rerun audit / show current contents. */
const REFUSE_OR_STATE_CHANGE_STOP_RERUN =
	/(?:refus(?:e|es|ed)|state chang(?:e|ed))[\s\S]{0,180}(?:stop|rerun(?:\s+the)?\s+audit|show(?:\s+current)?\s+contents)|(?:stop[\s\S]{0,80}(?:rerun(?:\s+the)?\s+audit|show(?:\s+current)?\s+contents)|rerun(?:\s+the)?\s+audit)[\s\S]{0,180}(?:refus(?:e|es|ed)|state chang(?:e|ed))/i;

/** Force only after separate fresh status + explicit destructive confirmation for exact paths. */
const FORCE_AFTER_FRESH_STATUS_AND_DESTRUCTIVE_CONFIRMATION =
	/(?:fresh (?:git )?status|separate fresh status)[\s\S]{0,160}(?:explicit )?(?:destructive )?confirmation[\s\S]{0,120}exact paths?|(?:--force|force)[\s\S]{0,200}(?:fresh (?:git )?status|separate fresh status)[\s\S]{0,160}(?:explicit )?(?:destructive )?confirmation[\s\S]{0,80}exact paths?/i;

function readSeam(path: string): string {
	expect(existsSync(path)).toBe(true);
	return readFileSync(path, "utf8");
}

function orchInvocationIsStoreBound(args: string): boolean {
	return /(?:^|\s)--store\s+\S+/.test(args);
}

function hasPriorOrchStoreExport(body: string, at: number): boolean {
	const before = body.slice(0, at);
	return /export\s+ORCH_STORE=\S+/.test(before);
}

describe("pstack native guidance content contracts", () => {
	test("orchestrate binds orch to an OMP store and wakes via /goal set, not a loop skill", () => {
		const body = readSeam(ORCHESTRATE);

		const unbound: string[] = [];
		for (const match of body.matchAll(ORCH_INVOCATION)) {
			const args = match[1] ?? "";
			const index = match.index ?? 0;
			if (
				!orchInvocationIsStoreBound(args) &&
				!hasPriorOrchStoreExport(body, index)
			) {
				unbound.push(match[0]);
			}
		}
		expect(unbound).toEqual([]);

		expect(body).not.toMatch(/loop skill/i);
		expect(body).toMatch(
			/frontier watcher[\s\S]{0,160}\/goal set|\/goal set[\s\S]{0,160}frontier watcher/i,
		);
	});

	test("worktree cleanup does not delete Cursor user state", () => {
		const body = readSeam(WORKTREE_CLEANUP);

		expect(body).not.toMatch(
			/Application Support\/Cursor|state\.vscdb|snapshots\/roots/i,
		);
	});

	test("worktree cleanup pins scratch-safe gates, ordinary remove, and gated force", () => {
		const body = readSeam(WORKTREE_CLEANUP);
		const violations: string[] = [];

		if (SCRATCH_THROWAWAY_OR_SAFE_DROP.test(body)) {
			violations.push(
				"frames scratch/untracked/ignored as throwaway, disposable, or safe to drop",
			);
		}
		if (!EXACT_PATHS_SIZES_AND_CONFIRMATION.test(body)) {
			violations.push(
				"missing exact paths + sizes + explicit confirmation for tracked/untracked/ignored content",
			);
		}
		if (!AUTO_PROCEED_CLEAN_MERGED_NO_OPEN_PR_NOT_IN_USE.test(body)) {
			violations.push(
				"auto-proceed must require clean + merged + no-open-PR + not-in-use",
			);
		}
		if (!ORDINARY_WORKTREE_REMOVE.test(body)) {
			violations.push(
				"missing ordinary default `git worktree remove -- <path>`",
			);
		}
		if (!PATH_QUOTING.test(body)) {
			violations.push("missing path quoting guidance for worktree remove");
		}
		if (DEFAULT_FORCE_REMOVE.test(body)) {
			violations.push(
				"default prune still prescribes `git worktree remove --force`",
			);
		}
		if (RM_RF.test(body)) {
			violations.push("cleanup still teaches `rm -rf`");
		}
		if (!REFUSE_OR_STATE_CHANGE_STOP_RERUN.test(body)) {
			violations.push(
				"missing stop + rerun audit / show contents when remove refuses or state changed",
			);
		}
		if (!FORCE_AFTER_FRESH_STATUS_AND_DESTRUCTIVE_CONFIRMATION.test(body)) {
			violations.push(
				"force is not gated behind fresh status + explicit destructive confirmation for exact paths",
			);
		}

		expect(violations).toEqual([]);
	});

	test("benny stays dormant without a native scheduler, enables pstack only via OMP, and does not hand-author registry JSON or runnable Cursor automate/editor steps", () => {
		const readme = readSeam(BENNY_README);
		const setup = readSeam(SETUP_BENNY);
		const forAgents = readSeam(BENNY_FOR_AGENTS);

		for (const body of [readme, setup, forAgents]) {
			expect(body).toMatch(/\bdormant\b|\barchive-only\b/i);
			expect(body).toMatch(
				/no native scheduler|without (?:a )?native scheduler|no native activation(?: path)?/i,
			);
		}

		for (const body of [readme, setup]) {
			expect(body).not.toMatch(
				/(?:let|run|use|invoke|follow|open|ask)\b[\s\S]{0,100}(?:\/automate|`automate`|Automations editor)/i,
			);
			expect(body).not.toMatch(
				/Automations editor[\s\S]{0,60}handoff|handoff[\s\S]{0,60}Automations editor/i,
			);
			expect(body).not.toMatch(
				/update (?:each )?(?:existing )?automations? (?:directly )?in (?:its |their )?(?:Automations )?editors?/i,
			);
			expect(body).not.toMatch(
				/```(?:json)?\s*\{[\s\S]*?"plugins"\s*:\s*\{[\s\S]*?"pstack"[\s\S]*?\}\s*```/,
			);
			expect(body).not.toMatch(
				/"pstack"\s*:\s*\{\s*"enabled"\s*:\s*true\s*\}/,
			);
		}

		expect(readme).toContain(OMP_PLUGIN_ENABLE);

		// Active agent entrypoint: reject every runnable activation/bootstrap step.
		expect(forAgents).not.toMatch(
			/merge the entire source pack|copy (?:this |the )?(?:whole |entire )?pack into/i,
		);
		expect(forAgents).not.toMatch(/omp plugin enable/);
		expect(forAgents).not.toMatch(/omp plugin list/);
		expect(forAgents).not.toMatch(
			/(?:use|run|invoke|follow)\b[\s\S]{0,80}(?:\/automate|`automate`)|(?:\/automate|`automate`)[\s\S]{0,80}(?:once|handoff|editor)/i,
		);
		expect(forAgents).not.toMatch(
			/Automations editor|edit each automation directly in its editor/i,
		);
		expect(forAgents).not.toMatch(
			/read and follow[\s\S]{0,120}setup-benny/i,
		);
	});
});
