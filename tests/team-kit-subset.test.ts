import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seams (parity inventory):
 * - skills/deslop, skills/control-cli, skills/control-ui
 * - Cursor MIT notice under LICENSES/
 *
 * Independent source of truth: pstack README "not shipped here" + PR #73 —
 * exactly these three cursor-team-kit skills are the P-Stack-referenced optional
 * subset. File shape is the interface for this inventory.
 */

const ROOT = join(import.meta.dir, "..");
const SKILLS_DIR = join(ROOT, "skills");
const LICENSES_DIR = join(ROOT, "LICENSES");

const BUNDLED_TEAM_KIT_SKILLS = ["deslop", "control-cli", "control-ui"] as const;

/** Full cursor-team-kit skill inventory minus the P-Stack-referenced subset. */
const EXCLUDED_TEAM_KIT_SKILLS = [
	"check-compiler-errors",
	"fix-ci",
	"fix-merge-conflicts",
	"get-pr-comments",
	"loop-on-ci",
	"make-pr-easy-to-review",
	"new-branch-and-pr",
	"pr-review-canvas",
	"review-and-ship",
	"run-smoke-tests",
	"thermo-nuclear-code-quality-review",
	"verify-this",
	"weekly-review",
	"what-did-i-get-done",
	"workflow-from-chats",
] as const;

type Frontmatter = Record<string, string>;

function parseSkillFrontmatter(content: string): Frontmatter {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) {
		throw new Error("SKILL.md is missing YAML frontmatter delimited by ---");
	}
	const fields: Frontmatter = {};
	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		fields[key] = value;
	}
	return fields;
}

function readSkill(name: string): { path: string; body: string; frontmatter: Frontmatter } {
	const path = join(SKILLS_DIR, name, "SKILL.md");
	expect(existsSync(path)).toBe(true);
	const body = readFileSync(path, "utf8");
	return { path, body, frontmatter: parseSkillFrontmatter(body) };
}

function assertValidOmpSkillFrontmatter(name: string, frontmatter: Frontmatter) {
	// omp-plugins / native skill discovery require name + description.
	expect(frontmatter.name).toBe(name);
	expect(typeof frontmatter.description).toBe("string");
	expect(frontmatter.description.length).toBeGreaterThan(0);
}

function listLicenseFiles(dir: string): string[] {
	if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listLicenseFiles(full));
		} else if (entry.isFile()) {
			out.push(full);
		}
	}
	return out;
}

describe("team-kit subset parity", () => {
	test("bundles exactly the three P-Stack-referenced team-kit skills with OMP frontmatter, core guardrails, Cursor MIT notice, and no leftover kit skills", () => {
		expect(existsSync(SKILLS_DIR)).toBe(true);

		for (const name of BUNDLED_TEAM_KIT_SKILLS) {
			const skill = readSkill(name);
			assertValidOmpSkillFrontmatter(name, skill.frontmatter);
		}

		// deslop: diff cleanup without behavior change
		{
			const { body, frontmatter } = readSkill("deslop");
			expect(frontmatter.description.toLowerCase()).toContain("slop");
			expect(body).toMatch(/diff against main/i);
			expect(body).toMatch(/Keep behavior unchanged/i);
			expect(body).toMatch(/Extra comments/i);
			expect(body).toMatch(/Prefer minimal, focused edits/i);
		}

		// control-cli: local deterministic PTY/TUI harness, evidence, cleanup
		{
			const { body, frontmatter } = readSkill("control-cli");
			expect(frontmatter.description.toLowerCase()).toMatch(/cli|tui/);
			expect(body).toMatch(/tmux/i);
			expect(body).toMatch(/PTY/i);
			expect(body).toMatch(/Prefer deterministic waits over sleeps/i);
			expect(body).toMatch(/Keep the harness in `?\/tmp`?/i);
			expect(body).toMatch(/Clean up tmux sessions/i);
			expect(body).toMatch(/Save the transcript/i);
		}

		// control-ui: browser/CDP accessibility-first drive, evidence, cleanup
		{
			const { body, frontmatter } = readSkill("control-ui");
			expect(frontmatter.description.toLowerCase()).toMatch(/browser|cdp|ui/);
			expect(body).toMatch(/connectOverCDP|remote-debugging-port|CDP/i);
			expect(body).toMatch(/Prefer accessibility roles, labels/i);
			expect(body).toMatch(/screenshot|snapshot/i);
			expect(body).toMatch(/Clean up dev servers, debug sessions/i);
			expect(body).toMatch(/Do not add Playwright as a project dependency/i);
		}

		for (const name of EXCLUDED_TEAM_KIT_SKILLS) {
			expect(existsSync(join(SKILLS_DIR, name))).toBe(false);
		}

		const bundledNames = new Set<string>(BUNDLED_TEAM_KIT_SKILLS);
		const skillDirs = existsSync(SKILLS_DIR)
			? readdirSync(SKILLS_DIR, { withFileTypes: true })
					.filter((d) => d.isDirectory())
					.map((d) => d.name)
			: [];
		for (const dir of skillDirs) {
			if (EXCLUDED_TEAM_KIT_SKILLS.includes(dir as (typeof EXCLUDED_TEAM_KIT_SKILLS)[number])) {
				throw new Error(`excluded team-kit skill unexpectedly present: ${dir}`);
			}
		}
		for (const name of bundledNames) {
			expect(skillDirs).toContain(name);
		}

		// Cursor MIT notice retained under LICENSES/
		expect(existsSync(LICENSES_DIR)).toBe(true);
		const licenseFiles = listLicenseFiles(LICENSES_DIR);
		expect(licenseFiles.length).toBeGreaterThan(0);
		const cursorNotice = licenseFiles
			.map((path) => ({ path, text: readFileSync(path, "utf8") }))
			.find(
				({ text }) =>
					text.includes("Copyright (c) 2026 Cursor") &&
					text.includes("Permission is hereby granted, free of charge") &&
					/MIT License/i.test(text),
			);
		expect(cursorNotice).toBeDefined();
	});
});
