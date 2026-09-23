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
const EXTENSION_ENTRY = "./src/extension.ts";

const REQUIRED_PUBLISH_PATHS = [
	"src",
	"skills",
	"agents",
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

/** Exact safe stale-symlink cleanup command: no wildcard or recursive flags. */
const STALE_SYMLINK_RM_COMMAND = 'rm -- "<plugins_directory>/node_modules/@defaceroot/omp-pstack"';

const LAUREN_TAN_NOTICE = "Copyright (c) 2026 Lauren Tan";
const CURSOR_NOTICE = "Copyright (c) 2026 Cursor";

type PackageJson = {
	name?: unknown;
	version?: unknown;
	private?: unknown;
	scripts?: Record<string, unknown>;
	peerDependencies?: Record<string, unknown>;
	peerDependenciesMeta?: Record<string, { optional?: unknown } | unknown>;
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
	expect(typeof pkg.version).toBe("string");
	expect(pkg.private).toBe(false);
	expect(pkg.omp?.extensions).toEqual([EXTENSION_ENTRY]);

	const extensionPath = join(ROOT, normalizeFilesEntry(EXTENSION_ENTRY));
	expect(existsSync(extensionPath)).toBe(true);
	expect(statSync(extensionPath).isFile()).toBe(true);

	// The README names the ported upstream release; package metadata must agree with it.
	const readme = readReadme();
	expect(readme).toContain(`P-Stack ${pkg.pstackPort?.upstreamVersion}`);
	expect(readme).toContain(String(pkg.pstackPort?.upstreamCommit));

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

test("package.json peerDependencies requires @oh-my-pi/pi-coding-agent >=18.2.11", () => {
	const pkg = readPackageJson();
	const peer = pkg.peerDependencies ?? {};
	// Exact peer range: VERSION gate enforces the floor.
	expect(peer["@oh-my-pi/pi-coding-agent"]).toBe(">=18.2.11");
});

test('package.json peerDependenciesMeta["@oh-my-pi/pi-coding-agent"].optional === true', () => {
	const pkg = readPackageJson();
	const peerMeta = pkg.peerDependenciesMeta ?? {};
	// optional meta prevents Bun plugin install from auto-installing a duplicate coding-agent
	// under ~/.omp/plugins.
	expect(
		(peerMeta["@oh-my-pi/pi-coding-agent"] as { optional?: unknown } | undefined)
			?.optional === true,
	).toBe(true);
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

test("README stale-symlink cleanup runs omp plugin doctor before one exact, non-recursive rm", () => {
	const readme = readReadme();
	const cleanupBlock = findOrderedStaleSymlinkCleanupBlock(readme);
	expect(cleanupBlock).toBeDefined();
	expect(cleanupBlock!.lang).toBe("sh");
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
