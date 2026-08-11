import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seams:
 * - package.json metadata (name, private, omp.extensions, files, pstackPort, scripts)
 * - README install/removal/verification documentation
 * - root licensing notices for Lauren Tan and Cursor
 *
 * Independent source of truth: orchestrator assignment + Main install/metadata pins.
 */

const ROOT = join(import.meta.dir, "..");
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const README_PATH = join(ROOT, "README.md");

const PACKAGE_NAME = "@defaceroot/omp-pstack";
const EXTENSION_ENTRY = "./src/extension.ts";
const UPSTREAM_COMMIT = "6f7e183aa9f48805c38746705fe6a17d42cafb94";
const UPSTREAM_VERSION = "0.14.0";

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

const LIFECYCLE_SCRIPT_KEYS = ["preinstall", "install", "postinstall"] as const;

const OUTSIDE_PACKAGE_WRITE_MARKERS = [
	"~/",
	"$HOME",
	"${HOME}",
	"/home/",
	"~/.omp",
	"/tmp/",
	"../",
] as const;

const LAUREN_TAN_NOTICE = "Copyright (c) 2026 Lauren Tan";
const CURSOR_NOTICE = "Copyright (c) 2026 Cursor";

type PackageJson = {
	name?: unknown;
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

function filesEntryCovers(files: string[], required: string): boolean {
	return files.some((entry) => {
		const normalized = entry.replace(/^\.\//, "").replace(/\/$/, "");
		return (
			normalized === required ||
			required.startsWith(`${normalized}/`) ||
			normalized.startsWith(`${required}/`)
		);
	});
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

test("package metadata and README document a removable git-installable omp-pstack extension", () => {
	const pkg = readPackageJson();

	expect(pkg.name).toBe(PACKAGE_NAME);
	expect(pkg.private).toBe(false);
	expect(pkg.omp?.extensions).toEqual([EXTENSION_ENTRY]);

	expect(pkg.pstackPort?.upstreamVersion).toBe(UPSTREAM_VERSION);
	expect(pkg.pstackPort?.upstreamCommit).toBe(UPSTREAM_COMMIT);

	expect(Array.isArray(pkg.files)).toBe(true);
	const files = (pkg.files as unknown[]).filter(
		(entry): entry is string => typeof entry === "string",
	);
	expect(files.length).toBeGreaterThan(0);
	const missingPublishPaths = REQUIRED_PUBLISH_PATHS.filter(
		(path) => !filesEntryCovers(files, path),
	);
	expect(missingPublishPaths).toEqual([]);

	const scripts = pkg.scripts ?? {};
	for (const key of LIFECYCLE_SCRIPT_KEYS) {
		const body = scripts[key];
		if (typeof body !== "string") {
			expect(body).toBeUndefined();
			continue;
		}
		for (const marker of OUTSIDE_PACKAGE_WRITE_MARKERS) {
			expect(body.includes(marker)).toBe(false);
		}
	}

	const readme = readReadme();
	expect(readme).toContain("omp install github:DefaceRoot/omp-pstack");
	expect(
		readme.includes("omp install ./omp-pstack") || readme.includes("omp install ."),
	).toBe(true);
	expect(readme).toContain("omp plugin disable @defaceroot/omp-pstack");
	expect(readme).toContain("/pstack-cleanup");
	expect(readme).toContain("omp plugin uninstall @defaceroot/omp-pstack");
	expect(readme).toContain("omp plugin list --json");
	expect(readme).toContain("/pstack-status");
	expect(readme).toContain(PACKAGE_NAME);

	expect(readme).toContain("https://github.com/cursor/plugins/tree/main/pstack");
	expect(readme).toContain(
		"https://github.com/cursor/plugins/tree/main/cursor-team-kit",
	);

	expect(readme).toMatch(/plugin-owned|package-owned|shipped by the plugin/i);
	expect(readme).toMatch(/user-generated|user-created|user-owned/i);
	expect(readme).toContain("~/.omp/agent/rules/pstack-models.md");
	expect(readme).toMatch(/\bskills\/\b/);

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
