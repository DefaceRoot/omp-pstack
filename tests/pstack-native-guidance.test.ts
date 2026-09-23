import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seams (text/instructions only):
 * - skills/poteto-mode/playbooks/orchestrate.md
 * - skills/poteto-mode/playbooks/worktree-cleanup.md
 *
 * Independent source of truth: OMP orch store binding (`--store` / `ORCH_STORE`),
 * OMP `/goal set` wake (not a pstack "loop skill"), and no editor user-state deletion.
 *
 * Worktree cleanup safety (worktree-cleanup.md): any tracked, untracked, or
 * ignored content needs exact paths and sizes shown plus explicit user
 * confirmation; never call untracked/ignored "throwaway" or disposable. Only
 * clean + merged + no-open-PR + not-in-use worktrees may auto-proceed. Default
 * removal is ordinary `git worktree remove -- <path>` with proper quoting; on
 * refuse or state change, stop and rerun audit / show current contents. Forbid
 * default `git worktree remove --force` and `rm -rf`; force only after a
 * separate fresh status and explicit destructive confirmation for exact paths.
 * Detached linked worktrees are never removed merely because a review row was
 * confirmed: before any detached removal, verify HEAD is reachable from a
 * durable branch/tag ref; if not, create or offer a named backup ref and require
 * explicit confirmation. Scope any "refs survive removal" reassurance to
 * branch-attached worktrees only.
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

/** Detached worktrees must not be removed merely because a review row was confirmed. */
const DETACHED_NOT_REMOVED_ON_REVIEW_ROW_ALONE =
	/detached[\s\S]{0,240}(?:never|not|must not)[\s\S]{0,120}(?:remov|prun|delet)[\s\S]{0,200}(?:review row|confirmed (?:a )?review|merely because)|(?:review row|merely because[\s\S]{0,80}(?:review|confirm))[\s\S]{0,200}detached/i;

/** Before detached removal: verify HEAD is reachable from a durable branch/tag ref. */
const DETACHED_HEAD_REACHABLE_FROM_DURABLE_REF =
	/detached[\s\S]{0,220}(?:reachable|reachability|verify)[\s\S]{0,160}(?:durable )?(?:branch|tag)(?:\/|\s*\/\s*|,|\s+or\s+|\s+)(?:tag|branch)?\s*refs?|(?:reachable from|reachability)[\s\S]{0,100}(?:durable )?(?:branch(?:\/|\s+or\s+|\/)tag|tag(?:\/|\s+or\s+|\/)branch|branch|tag)\s*refs?/i;

/** If HEAD is not on a durable ref: create or offer a named backup ref + explicit confirmation. */
const DETACHED_BACKUP_REF_AND_EXPLICIT_CONFIRMATION =
	/(?:backup ref|named (?:backup )?ref)[\s\S]{0,180}(?:explicit )?(?:user )?confirmation|(?:create|offer)[\s\S]{0,100}(?:named )?(?:backup )?ref[\s\S]{0,180}(?:explicit )?(?:user )?confirmation/i;

/** Any "refs survive removal" reassurance must be scoped to branch-attached worktrees. */
const REFS_SURVIVE_SCOPED_TO_BRANCH_ATTACHED =
	/branch-attached[\s\S]{0,160}(?:branch )?refs? survive|(?:branch )?refs? survive[\s\S]{0,160}branch-attached/i;

/** Unscoped claim that branch/refs survive (overclaims for detached HEAD). */
const UNSCOPED_REFS_SURVIVE =
	/(?:Branch refs survive|refs survive[\s\S]{0,80}(?:no commits? (?:are )?lost|commits? (?:are )?not lost))/i;

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

	test("worktree cleanup pins scratch-safe gates, ordinary remove, gated force, and detached HEAD backup refs", () => {
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
		if (!DETACHED_NOT_REMOVED_ON_REVIEW_ROW_ALONE.test(body)) {
			violations.push(
				"detached linked worktrees must not be removed merely because a review row was confirmed",
			);
		}
		if (!DETACHED_HEAD_REACHABLE_FROM_DURABLE_REF.test(body)) {
			violations.push(
				"before detached removal, missing verify HEAD reachable from durable branch/tag ref",
			);
		}
		if (!DETACHED_BACKUP_REF_AND_EXPLICIT_CONFIRMATION.test(body)) {
			violations.push(
				"detached unreachable HEAD missing named backup ref create/offer + explicit confirmation",
			);
		}
		if (UNSCOPED_REFS_SURVIVE.test(body) && !REFS_SURVIVE_SCOPED_TO_BRANCH_ATTACHED.test(body)) {
			violations.push(
				"refs-survive reassurance overclaims branch refs; must scope to branch-attached worktrees only",
			);
		}
		if (!REFS_SURVIVE_SCOPED_TO_BRANCH_ATTACHED.test(body)) {
			violations.push(
				"missing refs-survive reassurance scoped to branch-attached worktrees only",
			);
		}

		expect(violations).toEqual([]);
	});

});
