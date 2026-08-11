import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import inventory from "./fixtures/pstack-inventory.json";

const repoRoot = join(import.meta.dir, "..");

const TEXT_EXTENSIONS = new Set([
	".md",
	".mdc",
	".ts",
	".tsx",
	".js",
	".mjs",
	".cjs",
	".sh",
	".tsv",
	".yaml",
	".yml",
	".json",
	".txt",
	".example",
]);

function isTextPath(path: string): boolean {
	const base = path.split("/").pop() ?? path;
	if (base === "watch-pr" || base.endsWith(".sh")) return true;
	const dot = base.lastIndexOf(".");
	if (dot < 0) return false;
	return TEXT_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

function walkFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walkFiles(full));
			continue;
		}
		if (entry.isFile()) out.push(full);
	}
	return out;
}

function readOperationalCorpus(): string {
	const chunks: string[] = [];
	for (const tree of inventory.operationalTrees) {
		const abs = join(repoRoot, tree);
		for (const file of walkFiles(abs)) {
			const rel = relative(repoRoot, file).replaceAll("\\", "/");
			if (rel.includes("/images/")) continue;
			if (!isTextPath(rel)) continue;
			chunks.push(readFileSync(file, "utf8"));
		}
	}
	return chunks.join("\n");
}

test("shipped omp-pstack retains full pstack inventory with OMP-native contracts", () => {
	expect(inventory.counts.skillDirectories).toBe(44);
	expect(inventory.counts.principles).toBe(21);
	expect(inventory.counts.playbooks).toBe(23);
	expect(inventory.playbooks).toContain("opening-a-pr");
	expect(inventory.skillDirectories).toEqual(
		inventory.skillDirectories.slice().sort(),
	);
	expect(inventory.principles.every((name) => name.startsWith("principle-"))).toBe(
		true,
	);

	const missing = inventory.requiredRelativePaths.filter((rel) => {
		const abs = join(repoRoot, rel);
		return !existsSync(abs) || !statSync(abs).isFile();
	});
	expect(missing).toEqual([]);

	for (const skill of inventory.skillDirectories) {
		expect(existsSync(join(repoRoot, "skills", skill))).toBe(true);
	}
	for (const playbook of inventory.playbooks) {
		expect(
			existsSync(
				join(repoRoot, "skills/poteto-mode/playbooks", `${playbook}.md`),
			),
		).toBe(true);
	}
	for (const agent of inventory.agents) {
		expect(existsSync(join(repoRoot, agent))).toBe(true);
	}
	for (const script of inventory.scripts) {
		expect(existsSync(join(repoRoot, script))).toBe(true);
	}
	expect(existsSync(join(repoRoot, inventory.showMeYourWorkLogHelper))).toBe(
		true,
	);
	for (const path of inventory.benny) {
		expect(existsSync(join(repoRoot, path))).toBe(true);
	}
	for (const path of inventory.guide) {
		expect(existsSync(join(repoRoot, path))).toBe(true);
	}

	const licensePath = join(repoRoot, inventory.mitNotice.path);
	expect(existsSync(licensePath)).toBe(true);
	const license = readFileSync(licensePath, "utf8");
	for (const needle of inventory.mitNotice.mustContain) {
		expect(license).toContain(needle);
	}

	const corpus = readOperationalCorpus();
	expect(corpus.length).toBeGreaterThan(0);
	for (const needle of inventory.ompNativeContracts.requiredSubstrings) {
		expect(corpus).toContain(needle);
	}

	const toolPattern = new RegExp(
		`\\b(?:${inventory.ompNativeContracts.requiredToolNameAnyOf
			.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("|")})\\b`,
	);
	expect(toolPattern.test(corpus)).toBe(true);

	for (const directive of inventory.ompNativeContracts.forbiddenActiveDirectives) {
		expect(corpus.includes(directive)).toBe(false);
	}
	for (const marker of inventory.ompNativeContracts.forbiddenOperationalPathMarkers) {
		expect(corpus.includes(marker)).toBe(false);
	}
});
