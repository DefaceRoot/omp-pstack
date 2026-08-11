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
