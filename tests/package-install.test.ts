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
/** Derived active-profile rule path — not a hardcoded universal ~/.omp/agent location. */
const GENERATED_MODEL_RULE = "<agent_dir>/rules/pstack-models.md";
const DEFAULT_PROFILE_AGENT_EXAMPLE = "~/.omp/agent";

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

/**
 * Exact current contract fenced example lines from README.
 * Compare after whitespace normalization only — no regex/blacklist paraphrases.
 */
const TEAM_KIT_EXAMPLE_LINES = [
	"/deslop Review the current branch diff against main and remove AI-generated code slop without changing behavior.",
	"/control-cli Reproduce the startup hang in `bun run tui`, enter `help`, then press Ctrl-C; capture the terminal transcript.",
	"/control-ui Start `bun run dev`, open http://localhost:3000, submit the login form, and capture a screenshot plus an accessibility snapshot.",
] as const;

/**
 * OMP 17.2.13 uninstall contract (PluginManager.link leaves a node_modules
 * symlink with no package dependency; bun uninstall exits 0 but may leave it).
 * Pin exact wording after whitespace normalization only.
 */
const REQUIRED_REMOTE_UNINSTALL_CLAUSE =
	"For a recommended GitHub remote install, uninstall removes OMP's managed installed copy cleanly.";
const REQUIRED_LOCAL_LINK_UNINSTALL_CLAUSE =
	"For a local-link install from a local checkout, uninstall removes OMP plugin registration but may leave the OMP node_modules symlink; it always preserves the user-owned checkout or working tree.";
const REQUIRED_STALE_SYMLINK_CLEANUP_CLAUSE =
	"After uninstall, run `omp plugin doctor` to obtain plugins_directory. If the stale symlink remains, manually remove only `<plugins_directory>/node_modules/@defaceroot/omp-pstack`.";
const STALE_SYMLINK_PATH =
	"<plugins_directory>/node_modules/@defaceroot/omp-pstack";
/** Exact safe stale-symlink cleanup command — no wildcard/recursive flags. */
const STALE_SYMLINK_RM_COMMAND =
	'rm -- "<plugins_directory>/node_modules/@defaceroot/omp-pstack"';

/**
 * README must declare the runtime floor explicitly and explain why.
 * package.json peerDependency is owned by NativeYieldRed — do not assert it here.
 */
const REQUIRED_OMP_RUNTIME_FLOOR = "OMP >=17.2.13";
const REQUIRED_OMP_RUNTIME_SAFETY_CLAUSE =
	"Requires OMP >=17.2.13 for runtime safety: local-link uninstall may leave a stale node_modules symlink, and the doctor-then-manual-rm cleanup contract depends on that OMP runtime behavior.";

/**
 * Profile-aware generated-rule contract. Pin exact wording after whitespace
 * normalization only — ~/.omp/agent may appear only as a labeled default example.
 */
const REQUIRED_PROFILE_CONFIG_CLAUSE =
	"Resolve the active agent_dir with `omp config path` (honors `--profile` / `OMP_PROFILE`).";
const REQUIRED_PROFILE_RULE_PATH_CLAUSE =
	"The generated model-routing rule is `<agent_dir>/rules/pstack-models.md`.";
const REQUIRED_PROFILE_COMMAND_CLAUSE =
	"`/setup-pstack` and `/pstack-cleanup` operate on the active OMP profile.";
const REQUIRED_DEFAULT_PROFILE_EXAMPLE_CLAUSE =
	"The default-profile path `~/.omp/agent` is an example only, not universal.";

const LAUREN_TAN_NOTICE = "Copyright (c) 2026 Lauren Tan";
const CURSOR_NOTICE = "Copyright (c) 2026 Cursor";

type PackageJson = {
	name?: unknown;
	version?: unknown;
	private?: unknown;
	scripts?: Record<string, unknown>;
	peerDependencies?: Record<string, unknown>;
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

/** Collapse whitespace only — preserves wording/polarity, ignores wrapping. */
function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function extractFencedBlocksWithLang(
	markdown: string,
): Array<{ lang: string; body: string }> {
	const blocks: Array<{ lang: string; body: string }> = [];
	const re = /```([^\n]*)\n([\s\S]*?)```/g;
	for (const match of markdown.matchAll(re)) {
		blocks.push({
			lang: (match[1] ?? "").trim().toLowerCase(),
			body: match[2] ?? "",
		});
	}
	return blocks;
}

function extractFencedBlocks(markdown: string): string[] {
	return extractFencedBlocksWithLang(markdown).map((block) => block.body);
}

/** Non-empty whitespace-normalized lines from all fenced code/example blocks. */
function fencedExampleLines(markdown: string): string[] {
	return extractFencedBlocks(markdown)
		.flatMap((block) => block.split("\n"))
		.map((line) => normalizeWhitespace(line))
		.filter((line) => line.length > 0);
}

/**
 * One fenced sh block must contain doctor then the exact safe rm command in order.
 * Rejects deleted/reordered/replaced rm and wildcard/recursive rm flags.
 */
function findOrderedStaleSymlinkCleanupBlock(
	markdown: string,
): { lang: string; lines: string[] } | undefined {
	for (const block of extractFencedBlocksWithLang(markdown)) {
		if (block.lang !== "sh" && block.lang !== "bash") continue;
		const lines = block.body
			.split("\n")
			.map((line) => normalizeWhitespace(line))
			.filter((line) => line.length > 0);
		const doctorIndex = lines.indexOf("omp plugin doctor");
		const rmIndex = lines.indexOf(STALE_SYMLINK_RM_COMMAND);
		if (doctorIndex < 0 || rmIndex < 0 || rmIndex <= doctorIndex) continue;

		const unsafeRm = lines.some(
			(line) =>
				/\brm\b/.test(line) &&
				(/[*?]/.test(line) ||
					/(^|\s)(-[a-zA-Z]*[rR]|--recursive)(\s|$)/.test(line)),
		);
		if (unsafeRm) continue;
		return { lang: block.lang, lines };
	}
	return undefined;
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

test("package.json peerDependencies requires @oh-my-pi/pi-coding-agent >=17.2.13", () => {
	const pkg = readPackageJson();
	const peer = pkg.peerDependencies ?? {};
	// Independent source of truth: OMP 17.2.13 public ExecutorOptions / restrictToolNames surface.
	expect(peer["@oh-my-pi/pi-coding-agent"]).toBe(">=17.2.13");
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

test("README fences a runnable P-Stack trial and pinned team-kit slash example lines", () => {
	const readme = readReadme();
	const lines = fencedExampleLines(readme);

	// Representative P-Stack trial must appear as runnable fenced lines, not prose token mentions.
	for (const command of PSTACK_TRIAL_COMMANDS) {
		expect(lines).toContain(normalizeWhitespace(command));
	}

	// Exact current team-kit example lines (whitespace-normalized only).
	for (const example of TEAM_KIT_EXAMPLE_LINES) {
		expect(lines).toContain(normalizeWhitespace(example));
	}
});

test("README polarity-binds cleanup to the derived active-profile rule and preserves user artifacts", () => {
	const readme = readReadme();
	const normalized = normalizeWhitespace(readme);
	const escapedRule = GENERATED_MODEL_RULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	expect(readme).toMatch(/plugin-owned|package-owned|shipped by the plugin/i);
	expect(readme).toMatch(/user-generated|user-created|user-owned/i);
	expect(normalized).toContain(normalizeWhitespace(GENERATED_MODEL_RULE));
	expect(readme).toMatch(/\bskills\/\b/);

	// Confirmed cleanup deletes only the derived active-profile rule path.
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

test("README pins profile-aware agent_dir resolution for setup/cleanup rule paths", () => {
	const readme = readReadme();
	const normalized = normalizeWhitespace(readme);

	expect(normalized).toContain(normalizeWhitespace(REQUIRED_PROFILE_CONFIG_CLAUSE));
	expect(normalized).toContain(normalizeWhitespace(REQUIRED_PROFILE_RULE_PATH_CLAUSE));
	expect(normalized).toContain(normalizeWhitespace(REQUIRED_PROFILE_COMMAND_CLAUSE));
	expect(normalized).toContain(normalizeWhitespace(REQUIRED_DEFAULT_PROFILE_EXAMPLE_CLAUSE));
	expect(normalized).toContain("omp config path");
	expect(normalized).toContain(normalizeWhitespace(GENERATED_MODEL_RULE));
	expect(normalized).toContain("--profile");
	expect(normalized).toContain("OMP_PROFILE");
	expect(normalized).toContain(DEFAULT_PROFILE_AGENT_EXAMPLE);
});

test("README requires OMP >=17.2.13 and explains the runtime safety dependency", () => {
	const readme = readReadme();
	const normalized = normalizeWhitespace(readme);

	expect(normalized).toContain(REQUIRED_OMP_RUNTIME_FLOOR);
	expect(normalized).toContain(normalizeWhitespace(REQUIRED_OMP_RUNTIME_SAFETY_CLAUSE));
});

test("README pins OMP 17.2.13 remote/local uninstall and stale symlink cleanup", () => {
	const readme = readReadme();
	const normalized = normalizeWhitespace(readme);

	// Exact semantic clauses: remote clean managed-copy removal; local-link may leave
	// the node_modules symlink while always preserving checkout.
	expect(normalized).toContain(
		normalizeWhitespace(REQUIRED_REMOTE_UNINSTALL_CLAUSE),
	);
	expect(normalized).toContain(
		normalizeWhitespace(REQUIRED_LOCAL_LINK_UNINSTALL_CLAUSE),
	);
	expect(normalized).toContain(
		normalizeWhitespace(REQUIRED_STALE_SYMLINK_CLEANUP_CLAUSE),
	);
	expect(normalized).toContain(normalizeWhitespace(STALE_SYMLINK_PATH));

	// One fenced sh block must contain the safe command order exactly:
	// omp plugin doctor → rm -- "<plugins_directory>/node_modules/@defaceroot/omp-pstack"
	// Fails if rm is deleted, reordered before doctor, replaced, or made recursive/wildcard.
	const cleanupBlock = findOrderedStaleSymlinkCleanupBlock(readme);
	expect(cleanupBlock).toBeDefined();
	expect(cleanupBlock!.lang).toBe("sh");
	expect(cleanupBlock!.lines).toContain("omp plugin doctor");
	expect(cleanupBlock!.lines).toContain(STALE_SYMLINK_RM_COMMAND);
	expect(cleanupBlock!.lines.indexOf("omp plugin doctor")).toBeLessThan(
		cleanupBlock!.lines.indexOf(STALE_SYMLINK_RM_COMMAND),
	);
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
