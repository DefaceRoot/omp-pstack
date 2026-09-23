import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PSTACK_ROLES } from "../src/model-roles.ts";

const ROOT = join(import.meta.dir, "..");
const OMP_BUNDLED_AGENTS = ["task", "scout", "sonic", "reviewer", "security-reviewer"];

function markdownFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return markdownFiles(path);
		return name.endsWith(".md") ? [path] : [];
	});
}

const shippedAgents = readdirSync(join(ROOT, "agents")).map((file) => {
	const body = readFileSync(join(ROOT, "agents", file), "utf8");
	return {
		name: /^name:\s*(\S+)/m.exec(body)?.[1],
		model: /^model:\s*"?([^"\n]+)"?/m.exec(body)?.[1],
	};
});

const guidance = [
	...markdownFiles(join(ROOT, "skills")),
	...markdownFiles(join(ROOT, "docs")),
	...markdownFiles(join(ROOT, "agents")),
	join(ROOT, "README.md"),
].map((path) => ({ path: relative(ROOT, path), body: readFileSync(path, "utf8") }));

test("every role-backed agent ships and routes through its registered role", () => {
	for (const role of PSTACK_ROLES) {
		expect(shippedAgents.find((agent) => agent.name === role.agent)?.model).toBe(`@${role.id}`);
	}
});

test("guidance only dispatches to agents that exist and only names registered P-Stack roles", () => {
	const known = new Set([...OMP_BUNDLED_AGENTS, ...shippedAgents.map((agent) => agent.name)]);
	const roles = new Set(PSTACK_ROLES.map((role) => `@${role.id}`));
	const broken: string[] = [];
	for (const { path, body } of guidance) {
		for (const [, agent] of body.matchAll(/agent:\s*\\?"([a-z][a-z0-9-]*)\\?"/g)) {
			if (!known.has(agent!)) broken.push(`${path}: unknown agent ${agent}`);
		}
		for (const [alias] of body.matchAll(/@pstack-[a-z-]+/g)) {
			if (!roles.has(alias)) broken.push(`${path}: unknown role ${alias}`);
		}
	}
	expect(broken).toEqual([]);
});
