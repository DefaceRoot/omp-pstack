import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seams (packaged agent-facing guidance):
 * - skills/poteto-mode/SKILL.md
 * - skills/how/SKILL.md
 * - skills/why/SKILL.md
 * - skills/swarm/SKILL.md
 * - skills/reflect/SKILL.md
 * - skills/recall/SKILL.md
 * - skills/automate-me/SKILL.md
 * - skills/show-me-your-work/SKILL.md
 * - skills/poteto-mode/playbooks/orchestrate.md
 * - skills/poteto-mode/references/plan.md
 * - skills/arena/SKILL.md
 * - skills/interrogate/SKILL.md
 * - docs/guide/01-setup.md
 * - README.md
 *
 * Independent source of truth: native-first routing.
 * Ordinary distinct slices share one model resolution and use a native
 * `task` batch with stable `name`s and `agent: "poteto-agent"`.
 * `pstack_task` is reserved for true model panels or per-arm model
 * selection. Taught native task items must not include a `model` field.
 * Assert nearby instruction blocks in explicit files, not corpus counts.
 */

const ROOT = join(import.meta.dir, "..");

const NATIVE_TASK_TOOL = /`task`/;
const POTETO_AGENT_FIELD = /agent:\s*"poteto-agent"/;
const NATIVE_TASK_BATCH =
	/(?:lowercase(?:\s+OMP)?\s+)?`task`[\s\S]{0,240}(?:batch|once)|(?:batch|once)[\s\S]{0,240}`task`/i;
const STABLE_NAME =
	/stable\s+names?|`name`|\bname:\s*["']|\{\s*name\b/i;
const PSTACK_TASK = /pstack_task/;
const PSTACK_FOR_ORDINARY_SLICES =
	/pstack_task[\s\S]{0,400}(?:distinct[\s\S]{0,40}assignments|slice assignments|slice workers|ordinary (?:distinct )?slices|strategy:\s*"slice")|(?:distinct[\s\S]{0,40}assignments|strategy:\s*"slice"|`slice` runs distinct|slice workers|Model-aware parallel work uses)[\s\S]{0,200}pstack_task|Model-aware parallel work uses `pstack_task`/i;
const NATIVE_FIRST_RULE =
	/native-first|ordinary (?:distinct )?slices[\s\S]{0,200}`task`|`task`[\s\S]{0,200}(?:batch|ordinary (?:distinct )?slices)|distinct slices[\s\S]{0,180}(?:lowercase )?`task`/i;
const PSTACK_RESERVED_FOR_MODELS =
	/pstack_task[\s\S]{0,240}(?:true model panels?|per-arm|model panels?)|(?:true model panels?|per-arm model|model panels?)[\s\S]{0,240}pstack_task/i;
const SWARM_RACE_PANEL =
	/identical-brief race[\s\S]{0,200}strategy:\s*"panel"|strategy:\s*"panel"[\s\S]{0,200}identical-brief race/;

function readSeam(relativePath: string): string {
	const absolute = join(ROOT, relativePath);
	expect(existsSync(absolute)).toBe(true);
	return readFileSync(absolute, "utf8");
}

function headingBlock(body: string, heading: string): string {
	const start = body.indexOf(heading);
	expect(body.includes(heading)).toBe(true);
	const hashes = heading.match(/^#+/)?.[0] ?? "##";
	const rest = body.slice(start + heading.length);
	const next = rest.search(new RegExp(`\\n#{1,${hashes.length}}\\s`));
	return next < 0
		? body.slice(start)
		: body.slice(start, start + heading.length + next);
}

function nearby(
	body: string,
	anchor: string,
	after = 420,
	before = 80,
): string {
	const start = body.indexOf(anchor);
	expect(body.includes(anchor)).toBe(true);
	return body.slice(Math.max(0, start - before), start + after);
}

function clause(
	body: string,
	startText: string,
	endText: string,
	leadIn = 120,
): string {
	const start = body.indexOf(startText);
	expect(body.includes(startText)).toBe(true);
	const end = body.indexOf(endText, start + startText.length);
	const core = end < 0 ? body.slice(start) : body.slice(start, end);
	return body.slice(Math.max(0, start - leadIn), start) + core;
}

function teachesNativeItemModel(block: string): boolean {
	if (!NATIVE_TASK_TOOL.test(block) || PSTACK_TASK.test(block)) return false;
	return (
		/\{[^}]{0,240}\bmodel\b/.test(block) ||
		/agent:\s*"poteto-agent"[\s\S]{0,160}\bmodel\s*:/.test(block)
	);
}

function nativeSliceViolations(
	label: string,
	block: string,
	names: readonly string[] = [],
): string[] {
	const violations: string[] = [];
	if (PSTACK_TASK.test(block)) {
		violations.push(
			`${label}: still prescribes pstack_task for an ordinary distinct slice`,
		);
	}
	if (!NATIVE_TASK_TOOL.test(block)) {
		violations.push(`${label}: missing native \`task\` tool`);
	}
	if (!POTETO_AGENT_FIELD.test(block)) {
		violations.push(`${label}: missing agent: "poteto-agent"`);
	}
	if (!NATIVE_TASK_BATCH.test(block) && !STABLE_NAME.test(block)) {
		violations.push(
			`${label}: missing native task batch with stable names`,
		);
	}
	for (const name of names) {
		if (!block.includes(name)) {
			violations.push(`${label}: missing stable name ${name}`);
		}
	}
	if (teachesNativeItemModel(block)) {
		violations.push(
			`${label}: taught native task item includes a model field`,
		);
	}
	return violations;
}

function centralRuleViolations(label: string, block: string): string[] {
	const violations: string[] = [];
	if (!NATIVE_FIRST_RULE.test(block)) {
		violations.push(
			`${label}: missing native-first rule that ordinary distinct slices use \`task\``,
		);
	}
	if (PSTACK_FOR_ORDINARY_SLICES.test(block)) {
		violations.push(
			`${label}: still prescribes pstack_task for ordinary distinct slices`,
		);
	}
	if (!PSTACK_RESERVED_FOR_MODELS.test(block)) {
		violations.push(
			`${label}: missing pstack_task reserved for true model panels or per-arm model selection`,
		);
	}
	return violations;
}

describe("native-first task routing in packaged guidance", () => {
	test("central rule sends ordinary slices to native task and reserves pstack_task for model panels", () => {
		const violations = [
			...centralRuleViolations(
				"skills/poteto-mode/SKILL.md ## Subagents",
				headingBlock(readSeam("skills/poteto-mode/SKILL.md"), "## Subagents"),
			),
			...centralRuleViolations(
				"README.md ### Run parallel model work",
				headingBlock(readSeam("README.md"), "### Run parallel model work"),
			),
			...centralRuleViolations(
				"docs/guide/01-setup.md ## Pick your models",
				headingBlock(readSeam("docs/guide/01-setup.md"), "## Pick your models"),
			),
		];

		expect(violations).toEqual([]);
	});

	test("ordinary distinct slices teach a native task batch with stable names and poteto-agent", () => {
		const how = readSeam("skills/how/SKILL.md");
		const why = readSeam("skills/why/SKILL.md");
		const swarm = readSeam("skills/swarm/SKILL.md");
		const reflect = readSeam("skills/reflect/SKILL.md");
		const recall = readSeam("skills/recall/SKILL.md");
		const automate = readSeam("skills/automate-me/SKILL.md");
		const showWork = readSeam("skills/show-me-your-work/SKILL.md");
		const orchestrate = readSeam(
			"skills/poteto-mode/playbooks/orchestrate.md",
		);
		const plan = readSeam("skills/poteto-mode/references/plan.md");
		const swarmFanout = headingBlock(swarm, "## Phase B: Fan out");
		const orchRoles = headingBlock(orchestrate, "#### Roles and placement");

		const violations = [
			...nativeSliceViolations(
				"skills/how/SKILL.md ### Step 2a. Explore",
				headingBlock(how, "### Step 2a. Explore (complex questions only)"),
			),
			...nativeSliceViolations(
				"skills/how/SKILL.md ### Step 2b. Direct Explain",
				headingBlock(how, "### Step 2b. Direct Explain (simple questions)"),
			),
			...nativeSliceViolations(
				"skills/how/SKILL.md ### Step 3. Synthesize",
				headingBlock(how, "### Step 3. Synthesize (complex questions only)"),
			),
			...nativeSliceViolations(
				"skills/why/SKILL.md ## Step 3. Spawn Parallel Investigators",
				headingBlock(
					why,
					"## Step 3. Spawn Parallel Investigators (default posture)",
				),
			),
			...nativeSliceViolations(
				"skills/why/SKILL.md ## Step 4. Synthesize",
				headingBlock(why, "## Step 4. Synthesize"),
			),
			...nativeSliceViolations(
				"skills/swarm/SKILL.md coverage clause",
				clause(
					swarmFanout,
					"For coverage",
					"For an identical-brief race",
				),
			),
			...nativeSliceViolations(
				"skills/reflect/SKILL.md same-model lenses",
				headingBlock(reflect, "### 2. Spawn three reviewers in parallel"),
				["judgment", "tooling", "divergent"],
			),
			...nativeSliceViolations(
				"skills/recall/SKILL.md chat-history fan-out",
				nearby(recall, "Fan out across chat history"),
			),
			...nativeSliceViolations(
				"skills/automate-me/SKILL.md ### 1. Mine their history",
				headingBlock(automate, "### 1. Mine their history"),
			),
			...nativeSliceViolations(
				"skills/show-me-your-work/SKILL.md ## Cross-model review of the trail",
				headingBlock(showWork, "## Cross-model review of the trail"),
			),
			...nativeSliceViolations(
				"skills/poteto-mode/playbooks/orchestrate.md worker waves",
				nearby(orchRoles, "worker waves", 220, 160),
			),
			...nativeSliceViolations(
				"skills/poteto-mode/playbooks/orchestrate.md Worker / verifier",
				nearby(orchRoles, "Worker / verifier", 360, 0),
			),
			...nativeSliceViolations(
				"skills/poteto-mode/references/plan.md parallel exploration",
				nearby(plan, "For parallel exploration", 180, 0),
			),
		];

		expect(violations).toEqual([]);
	});

	test("pstack_task stays reserved for true model panels and per-arm model selection", () => {
		const how = readSeam("skills/how/SKILL.md");
		const swarm = readSeam("skills/swarm/SKILL.md");
		const arena = readSeam("skills/arena/SKILL.md");
		const interrogate = readSeam("skills/interrogate/SKILL.md");
		const critics = headingBlock(how, "### Step 2. Spawn Critics");
		const swarmFanout = headingBlock(swarm, "## Phase B: Fan out");
		const arenaFanout = headingBlock(arena, "## Phase B: Fan out");
		const arenaJudge = headingBlock(arena, "## Phase C: Cross-judge");
		const reviewers = headingBlock(interrogate, "## Step 3, Spawn Reviewers");
		const violations: string[] = [];

		if (!PSTACK_TASK.test(critics) || !/strategy:\s*"panel"/.test(critics)) {
			violations.push(
				"skills/how/SKILL.md critics: must prescribe pstack_task panel",
			);
		}
		if (!PSTACK_TASK.test(swarmFanout) || !SWARM_RACE_PANEL.test(swarmFanout)) {
			violations.push(
				"skills/swarm/SKILL.md races: must prescribe pstack_task panel",
			);
		}
		if (
			!PSTACK_TASK.test(arenaFanout) ||
			!/strategy:\s*"panel"/.test(arenaFanout)
		) {
			violations.push(
				"skills/arena/SKILL.md Phase B: must prescribe pstack_task panel",
			);
		}
		if (!PSTACK_TASK.test(arenaJudge) || !/\bmodel\b/.test(arenaJudge)) {
			violations.push(
				"skills/arena/SKILL.md Phase C: must prescribe pstack_task per-arm model selection",
			);
		}
		if (
			!PSTACK_TASK.test(reviewers) ||
			!/strategy:\s*"panel"/.test(reviewers)
		) {
			violations.push(
				"skills/interrogate/SKILL.md reviewers: must prescribe pstack_task panel",
			);
		}

		expect(violations).toEqual([]);
	});
});
