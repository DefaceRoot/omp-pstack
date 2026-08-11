import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Public seam: skills/control-ui/SKILL.md (OMP-native browser/CDP guidance).
 *
 * Independent source of truth: TeamKitSliceReview findings on the reviewed
 * OMP adaptation — observation must be surfaced before action chooses a
 * target from that output, and multi-page CDP selection must bind an
 * explicit target rather than implying tab.observe() can re-select pages.
 */

const ROOT = join(import.meta.dir, "..");
const CONTROL_UI_SKILL = join(ROOT, "skills", "control-ui", "SKILL.md");

function readControlUiBody(): string {
	expect(existsSync(CONTROL_UI_SKILL)).toBe(true);
	return readFileSync(CONTROL_UI_SKILL, "utf8");
}

describe("control-ui OMP-native guidance contracts", () => {
	test("surfaces accessibility observation in its own browser run before acting, and binds multi-page CDP targets explicitly", () => {
		const body = readControlUiBody();

		// (1) Observation must be returned/displayed from one browser run; a later
		// run then chooses a target from that surfaced output — not an opaque
		// observe()+placeholder-click in the same run.
		expect(body).toMatch(
			/(?:return|display)\b[\s\S]{0,160}(?:tab\.observe\(\)|tab\.ariaSnapshot\(\)|accessibility (?:structure|snapshot|observation))|(?:tab\.observe\(\)|tab\.ariaSnapshot\(\)|accessibility (?:structure|snapshot|observation))[\s\S]{0,160}(?:return|display)\b/i,
		);
		expect(body).toMatch(
			/(?:subsequent|later|separate|follow-?up)\b[\s\S]{0,100}\brun\b|\brun\b[\s\S]{0,100}(?:subsequent|later|separate|follow-?up)/i,
		);
		expect(body).not.toMatch(
			/await\s+tab\.observe\(\);\s*\n\s*await\s+tab\.click\(["']aria\//i,
		);

		// (2) Multi-page CDP: enumerate/inspect candidates (title/URL) and bind the
		// selected page with an explicit target — tab.observe() cannot re-select pages.
		expect(body).toMatch(
			/app\.target|explicit target|target\s*(?:id|marker|binding)|reopen(?:s|ing)? with (?:an )?explicit target/i,
		);
		expect(body).toMatch(
			/(?:enumerat\w*|list(?:s|ing)?)\b[\s\S]{0,120}(?:title|URL|candidate)|(?:title|URL|candidate)[\s\S]{0,120}(?:enumerat\w*|list(?:s|ing)?)/i,
		);
		expect(body).not.toMatch(/tab\.observe\(\)[^\n]{0,100}\bselect\b/i);
	});
});
