import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seams:
 * - package.json metadata (name, version, private, omp.extensions, files, pstackPort, scripts)
 * - README install/removal/verification documentation
 * - root licensing notices for Lauren Tan and Cursor
 *
 * Independent source of truth: orchestrator assignment + Main install/metadata pins +
 * PackageDocsReview / PackageTestReview follow-up findings.
 */

const ROOT = join(import.meta.dir, "..");
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const README_PATH = join(ROOT, "README.md");

const PACKAGE_NAME = "@defaceroot/omp-pstack";
const PACKAGE_VERSION = "0.1.0";
const EXTENSION_ENTRY = "./src/extension.ts";
const UPSTREAM_COMMIT = "6f7e183aa9f48805c38746705fe6a17d42cafb94";
const UPSTREAM_VERSION = "0.14.0";
const GENERATED_MODEL_RULE = "~/.omp/agent/rules/pstack-models.md";

const REQUIRED_PUBLISH_PATHS = [
	"src",
	"skills",
	"agents",
	"automations",
	"docs",
	"LICENSE",
	"LICENSES",
	"README.md",
] as const;

/**
 * Complete npm lifecycle hook set. This package needs none.
 * Assert key absence only — do not scan command-string bodies.
 */
const NPM_LIFECYCLE_HOOKS = [
	"preinstall",
	"install",
	"postinstall",
	"preprepare",
	"prepare",
	"postprepare",
	"prepublish",
	"prepublishOnly",
	"publish",
	"postpublish",
	"prepack",
	"pack",
	"postpack",
	"preversion",
	"version",
	"postversion",
	"preuninstall",
	"uninstall",
	"postuninstall",
	"predependencies",
	"dependencies",
	"postdependencies",
] as const;

const PSTACK_TRIAL_COMMANDS = [
	"/setup-pstack",
	"/poteto-mode",
	"/pstack-status",
	"/pstack-off",
] as const;

const TEAM_KIT_COMMANDS = ["/deslop", "/control-cli", "/control-ui"] as const;

const LAUREN_TAN_NOTICE = "Copyright (c) 2026 Lauren Tan";
const CURSOR_NOTICE = "Copyright (c) 2026 Cursor";

type PackageJson = {
	name?: unknown;
	version?: unknown;
	private?: unknown;
	scripts?: Record<string, unknown>;
	files?: unknown;
	omp?: { extensions?: unknown };
	pstackPort?: {
		upstreamVersion?: unknown;
		upstreamCommit?: unknown;
	};
};

function readPackageJson(): PackageJson {
	expect(existsSync(PACKAGE_JSON_PATH)).toBe(true);
	return JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as PackageJson;
}

function readReadme(): string {
	expect(existsSync(README_PATH)).toBe(true);
	return readFileSync(README_PATH, "utf8");
}

function normalizeFilesEntry(entry: string): string {
	return entry.replace(/^\.\//, "").replace(/\/$/, "");
}

function extractFencedBlocks(markdown: string): string[] {
	const blocks: string[] = [];
	const re = /```[^\n]*\n([\s\S]*?)```/g;
	for (const match of markdown.matchAll(re)) {
		blocks.push(match[1] ?? "");
	}
	return blocks;
}

/** Non-empty trimmed lines from all fenced code/example blocks. */
function fencedExampleLines(markdown: string): string[] {
	return extractFencedBlocks(markdown)
		.flatMap((block) => block.split("\n"))
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/** Period/exclamation sentences inside blank-line paragraphs (semicolons stay in-clause). */
function uninstallSentences(text: string): string[] {
	return text
		.split(/\n{2,}/)
		.flatMap((paragraph) =>
			paragraph
				.replace(/\n+/g, " ")
				.split(/(?<=[.!])\s+/)
				.map((part) => part.trim())
				.filter((part) => part.length > 0 && /uninstall/i.test(part)),
		);
}

/** Determiners/adjectives allowed between a verb and its object. */
const VERB_OBJECT_DETERMINERS =
	"(?:(?:the|your|a|an|only|user-owned|local|omp'?s|managed|installed|plugin)\\s+)*";

/**
 * Polarity-bound verb→object matcher.
 * `never deletes X` is negative; bare `deletes X` is affirmative.
 * Rejects vacuities where `\bdeletes\b` matches inside `never deletes`.
 */
function hasPolarVerbObject(
	sentence: string,
	verbs: string,
	objectPattern: string,
	polarity: "affirmative" | "negative",
): boolean {
	const re = new RegExp(
		String.raw`\b(?:(never|does not|doesn't)\s+)?(${verbs})\s+${VERB_OBJECT_DETERMINERS}(?:${objectPattern})\b`,
		"gi",
	);
	for (const match of sentence.matchAll(re)) {
		const isNegative = Boolean(match[1]);
		if (polarity === "affirmative" && !isNegative) return true;
		if (polarity === "negative" && isNegative) return true;
	}
	return false;
}

/** Reject empty or placeholder-only task/input (e.g. `<task>`, `TODO`). */
function isConcreteTaskInput(task: string): boolean {
	const trimmed = task.trim();
	if (trimmed.length === 0) return false;
	if (/^<[^<>]+>$/.test(trimmed)) return false;
	if (/^\{[^{}]+\}$/.test(trimmed)) return false;
	if (/^\[[^\[\]]+\]$/.test(trimmed)) return false;
	if (/^(TODO|FIXME|TBD|WIP)$/i.test(trimmed)) return false;
	if (/^(\.{3}|…)$/.test(trimmed)) return false;
	if (/^task$/i.test(trimmed)) return false;
	return true;
}

function collectLicenseTexts(): Array<{ path: string; text: string }> {
	const out: Array<{ path: string; text: string }> = [];
	const rootLicense = join(ROOT, "LICENSE");
	if (existsSync(rootLicense) && statSync(rootLicense).isFile()) {
		out.push({ path: "LICENSE", text: readFileSync(rootLicense, "utf8") });
	}

	const licensesDir = join(ROOT, "LICENSES");
	if (existsSync(licensesDir) && statSync(licensesDir).isDirectory()) {
		for (const name of readdirSync(licensesDir)) {
			const abs = join(licensesDir, name);
			if (!statSync(abs).isFile()) continue;
			out.push({
				path: `LICENSES/${name}`,
				text: readFileSync(abs, "utf8"),
			});
		}
	}

	return out;
}

test("package.json names an installable omp-pstack extension with pinned metadata", () => {
	const pkg = readPackageJson();

	expect(pkg.name).toBe(PACKAGE_NAME);
	expect(pkg.version).toBe(PACKAGE_VERSION);
	expect(pkg.private).toBe(false);
	expect(pkg.omp?.extensions).toEqual([EXTENSION_ENTRY]);

	const extensionPath = join(ROOT, normalizeFilesEntry(EXTENSION_ENTRY));
	expect(existsSync(extensionPath)).toBe(true);
	expect(statSync(extensionPath).isFile()).toBe(true);

	expect(pkg.pstackPort?.upstreamVersion).toBe(UPSTREAM_VERSION);
	expect(pkg.pstackPort?.upstreamCommit).toBe(UPSTREAM_COMMIT);

	expect(Array.isArray(pkg.files)).toBe(true);
	const files = (pkg.files as unknown[])
		.filter((entry): entry is string => typeof entry === "string")
		.map(normalizeFilesEntry);
	expect(files.length).toBeGreaterThan(0);

	// Each required path must appear as itself in files[] — a child entry must not satisfy a parent.
	const missingPublishPaths = REQUIRED_PUBLISH_PATHS.filter(
		(path) => !files.includes(path),
	);
	expect(missingPublishPaths).toEqual([]);

	const scripts = pkg.scripts ?? {};
	const presentLifecycleHooks = NPM_LIFECYCLE_HOOKS.filter((key) =>
		Object.hasOwn(scripts, key),
	);
	expect(presentLifecycleHooks).toEqual([]);
});

test("README documents exact remote/local install, disable, cleanup, uninstall, and verification commands", () => {
	const readme = readReadme();
	const lines = fencedExampleLines(readme);

	expect(lines).toContain("omp install github:DefaceRoot/omp-pstack");
	expect(
		lines.includes("omp install ./omp-pstack") || lines.includes("omp install ."),
	).toBe(true);
	expect(lines).toContain("omp plugin disable @defaceroot/omp-pstack");
	expect(readme).toContain("/pstack-cleanup");
	expect(lines).toContain("omp plugin uninstall @defaceroot/omp-pstack");
	expect(lines).toContain("omp plugin list --json");
	expect(readme).toContain(PACKAGE_NAME);
});

test("README fences a runnable P-Stack trial and team-kit slash examples with nonempty task input", () => {
	const readme = readReadme();
	const lines = fencedExampleLines(readme);

	// Representative P-Stack trial must appear as runnable fenced lines, not prose token mentions.
	for (const command of PSTACK_TRIAL_COMMANDS) {
		expect(lines).toContain(command);
	}

	// Each team-kit slash example must be a fenced line with a concrete nonempty task/input.
	// Placeholder-only inputs like `<task>` or `TODO` do not count.
	for (const command of TEAM_KIT_COMMANDS) {
		const runnable = lines.find((line) => {
			if (!line.startsWith(`${command} `) && line !== command) return false;
			const task = line.slice(command.length).trim();
			return isConcreteTaskInput(task);
		});
		expect(runnable).toBeDefined();
		expect(isConcreteTaskInput(runnable!.slice(command.length))).toBe(true);
	}
});

test("README polarity-binds cleanup to the generated model rule and preserves user artifacts", () => {
	const readme = readReadme();
	const escapedRule = GENERATED_MODEL_RULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	expect(readme).toMatch(/plugin-owned|package-owned|shipped by the plugin/i);
	expect(readme).toMatch(/user-generated|user-created|user-owned/i);
	expect(readme).toContain(GENERATED_MODEL_RULE);
	expect(readme).toMatch(/\bskills\/\b/);

	// Confirmed cleanup deletes only the generated rule (markdown backticks allowed around the path).
	expect(readme).toMatch(
		new RegExp(
			`/pstack-cleanup[\\s\\S]{0,500}deletes only \\\`?${escapedRule}\\\`?`,
			"i",
		),
	);
	expect(readme).toMatch(/declin\w+[\s\S]{0,160}(leaves|leave|retain|unchanged)/i);
	expect(readme).toMatch(
		/uninstall\w*[\s\S]{0,500}(does not (remove|delete)|leaves?|remain)[\s\S]{0,200}(user-generated|user-created|user-owned)/i,
	);
	expect(readme).toMatch(
		/(uninstall|\/pstack-cleanup)[\s\S]{0,500}(does not (remove|delete)|leaves?|remain)[\s\S]{0,200}(local checkout|checkout|working tree)/i,
	);
});

test("README pins remote managed-copy removal and local-checkout non-deletion in bounded uninstall sentences", () => {
	const readme = readReadme();
	const bounded = uninstallSentences(readme);
	expect(bounded.length).toBeGreaterThan(0);

	// Affirmative remote managed-copy removal must live in its own uninstall sentence.
	// `never deletes ... managed copy` must not satisfy this (polarity-bound).
	const remoteManagedRemoval = bounded.find(
		(sentence) =>
			/(GitHub remote|remote install|managed)/i.test(sentence) &&
			hasPolarVerbObject(
				sentence,
				"removes|deletes",
				"managed (?:installed )?copy|installed copy",
				"affirmative",
			),
	);
	expect(remoteManagedRemoval).toBeDefined();

	// Explicit negative local-checkout deletion must bind the negation to checkout/working tree.
	// `does not remove metadata but deletes the checkout` must not satisfy this.
	const localCheckoutPreserved = bounded.find(
		(sentence) =>
			/(local(-|\s)?link|local checkout)/i.test(sentence) &&
			hasPolarVerbObject(
				sentence,
				"removes|deletes",
				"checkout|working tree",
				"negative",
			) &&
			!hasPolarVerbObject(
				sentence,
				"removes|deletes",
				"checkout|working tree",
				"affirmative",
			),
	);
	expect(localCheckoutPreserved).toBeDefined();

	// Local-link uninstall affirmatively removes registration/link (not `never removes`).
	const localLinkRegistration = bounded.find(
		(sentence) =>
			/(local(-|\s)?link|local checkout)/i.test(sentence) &&
			hasPolarVerbObject(
				sentence,
				"removes?",
				"registration(?:\/link)?|link",
				"affirmative",
			),
	);
	expect(localLinkRegistration).toBeDefined();
});

test("README links canonical upstream sources and root licensing retains separate Lauren Tan and Cursor notices", () => {
	const readme = readReadme();

	expect(readme).toContain("https://github.com/cursor/plugins/tree/main/pstack");
	expect(readme).toContain(
		"https://github.com/cursor/plugins/tree/main/cursor-team-kit",
	);

	const notices = collectLicenseTexts();
	expect(notices.length).toBeGreaterThan(0);

	const laurenNotice = notices.find(
		({ text }) =>
			text.includes(LAUREN_TAN_NOTICE) &&
			/MIT License/i.test(text) &&
			text.includes("Permission is hereby granted, free of charge"),
	);
	const cursorNotice = notices.find(
		({ text }) =>
			text.includes(CURSOR_NOTICE) &&
			/MIT License/i.test(text) &&
			text.includes("Permission is hereby granted, free of charge"),
	);

	expect(laurenNotice).toBeDefined();
	expect(cursorNotice).toBeDefined();
	expect(laurenNotice?.path).not.toBe(cursorNotice?.path);
});
