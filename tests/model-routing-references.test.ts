import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OMP_BUNDLED_AGENTS = ["task", "scout", "sonic", "reviewer", "security-reviewer"];

function markdownFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return markdownFiles(path);
		return name.endsWith(".md") ? [path] : [];
	});
}

const shippedAgents = readdirSync(join(ROOT, "agents"))
	.filter((file) => file.endsWith(".md"))
	.map((file) => {
		const body = readFileSync(join(ROOT, "agents", file), "utf8");
		const name = /^name:\s*([a-z][a-z0-9-]*)\s*$/m.exec(body)?.[1];
		if (!name) throw new Error(`Agent ${file} has no frontmatter name`);
		return name;
	});

const guidance = [
	...markdownFiles(join(ROOT, "skills")),
	...markdownFiles(join(ROOT, "docs")),
	...markdownFiles(join(ROOT, "agents")),
	join(ROOT, "README.md"),
].map((path) => ({ path: relative(ROOT, path), body: readFileSync(path, "utf8") }));

const dispatchPattern = /\bagent:\s*\\?["']([a-z][a-z0-9-]*)\\?["']/g;
const obsoleteToolName = ["pstack", "task"].join("_");
const obsoleteRolePrefix = ["@pstack", ""].join("-");

test("guidance dispatches only shipped or OMP bundled agents", () => {
	const known = new Set([...OMP_BUNDLED_AGENTS, ...shippedAgents]);
	const broken: string[] = [];
	for (const { path, body } of guidance) {
		for (const [, agent] of body.matchAll(dispatchPattern)) {
			if (!known.has(agent!)) broken.push(`${path}: unknown agent ${agent}`);
		}
	}
	expect(broken).toEqual([]);
});

test("every shipped P-Stack slot appears in a skill or playbook", () => {
	const operational = guidance.filter(({ path }) => path.startsWith("skills/"));
	const missing = shippedAgents
		.filter((name) => name.startsWith("pstack-"))
		.filter((name) => !operational.some(({ body }) => new RegExp(`\\b${name}\\b`).test(body)));
	expect(missing).toEqual([]);
});

test("guidance has no retired routing tool or role aliases", () => {
	const broken = guidance
		.filter(({ body }) => body.includes(obsoleteToolName) || body.includes(obsoleteRolePrefix))
		.map(({ path }) => path);
	expect(broken).toEqual([]);
});
