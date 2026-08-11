/**
 * Public seam:
 *   skills/poteto-mode/scripts/worktree-audit.sh
 * executed as a real subprocess against an isolated temporary
 * HOME / session-transcript / git-worktree fixture on Linux.
 *
 * Independent sources of truth:
 *   - worktree-cleanup playbook buckets (verify-recent-chat vs safe)
 *   - OMP session header shape: {"type":"session",...,"cwd":"<path>"}
 *   - acceptance: recent matching transcript must be detected on GNU/Linux;
 *     timestamp-read failure must be fail-closed / not-safe (not recent=no).
 *
 * No network, GitHub, or real user state.
 */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const AUDIT_SCRIPT = join(
	REPO_ROOT,
	"skills/poteto-mode/scripts/worktree-audit.sh",
);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type AuditRow = {
	lastChat: string;
	bucket: string;
	worktree: string;
};

type Fixture = {
	root: string;
	home: string;
	repo: string;
	worktree: string;
	bin: string;
};

const fixtures: string[] = [];

afterEach(() => {
	while (fixtures.length > 0) {
		const root = fixtures.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

function sh(
	command: string,
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): void {
	const result = Bun.spawnSync(["bash", "-lc", command], {
		cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`command failed (${result.exitCode}): ${command}\n${result.stderr.toString()}`,
		);
	}
}

function writeExecutable(path: string, body: string): void {
	writeFileSync(path, body, "utf8");
	chmodSync(path, 0o755);
}

function createFixture(options: { merged: boolean }): Fixture {
	const root = mkdtempSync(join(tmpdir(), "worktree-audit-portability-"));
	fixtures.push(root);

	const home = join(root, "home");
	const repo = join(root, "repo");
	const worktree = join(root, "wt-candidate");
	const bin = join(root, "bin");
	mkdirSync(home, { recursive: true });
	mkdirSync(repo, { recursive: true });
	mkdirSync(bin, { recursive: true });

	// Offline stub: never talk to GitHub.
	writeExecutable(join(bin, "gh"), "#!/bin/sh\necho '[]'\nexit 0\n");

	const gitEnv = {
		...process.env,
		HOME: home,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
		PATH: `${bin}:${process.env.PATH ?? ""}`,
	};

	sh("git init -q", repo, gitEnv);
	sh("git config user.email portability@example.com", repo, gitEnv);
	sh("git config user.name Portability", repo, gitEnv);
	writeFileSync(join(repo, "README"), "base\n", "utf8");
	sh("git add README && git commit -qm init && git branch -M main", repo, gitEnv);
	sh(`git worktree add -q -b candidate "${worktree}" HEAD`, repo, gitEnv);

	if (options.merged) {
		// Local-only remote-tracking ref so merge-base can succeed without fetch/network.
		sh(
			`git update-ref refs/remotes/origin/main "$(git rev-parse HEAD)"`,
			repo,
			gitEnv,
		);
	}

	return { root, home, repo, worktree, bin };
}

function writeMatchingTranscript(home: string, cwd: string): string {
	const sessionDir = join(
		home,
		".omp",
		"agent",
		"sessions",
		"portability-session",
	);
	mkdirSync(sessionDir, { recursive: true });
	const transcript = join(sessionDir, "session.jsonl");
	writeFileSync(
		transcript,
		`${JSON.stringify({
			type: "session",
			version: 3,
			id: "portability-session",
			timestamp: "2026-08-11T12:00:00.000Z",
			cwd,
		})}\n`,
		"utf8",
	);
	return transcript;
}

function runAudit(
	fixture: Fixture,
): { stdout: string; stderr: string; rows: AuditRow[] } {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: fixture.home,
		PATH: `${fixture.bin}:${process.env.PATH ?? ""}`,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
	};
	delete env.XDG_DATA_HOME;

	const result = Bun.spawnSync(["bash", AUDIT_SCRIPT, fixture.repo], {
		cwd: fixture.repo,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		throw new Error(
			`worktree-audit.sh exited ${result.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
		);
	}

	const rows = stdout
		.trimEnd()
		.split("\n")
		.slice(1)
		.filter(Boolean)
		.map((line) => {
			const cols = line.split("\t");
			return {
				lastChat: cols[6] ?? "",
				bucket: cols[7] ?? "",
				worktree: cols[8] ?? "",
			};
		});

	return { stdout, stderr, rows };
}

function rowFor(rows: AuditRow[], worktree: string): AuditRow {
	const row = rows.find((r) => r.worktree === worktree);
	expect(row).toBeDefined();
	return row as AuditRow;
}

test("recent matching transcript on GNU/Linux is detected as verify-recent-chat", () => {
	const fixture = createFixture({ merged: false });
	writeMatchingTranscript(fixture.home, fixture.worktree);

	const { rows } = runAudit(fixture);
	const row = rowFor(rows, fixture.worktree);

	expect(row.bucket).toBe("verify-recent-chat");
	expect(row.lastChat).toMatch(DATE_RE);
});

test("timestamp-read failure is fail-closed / not-safe rather than recent=no", () => {
	const fixture = createFixture({ merged: true });
	writeMatchingTranscript(fixture.home, fixture.worktree);

	// Force timestamp-read failure at the process boundary while leaving a
	// matching transcript in place. Without fail-closed handling, the audit
	// collapses to recent=no and (because merged) incorrectly buckets as safe.
	writeExecutable(
		join(fixture.bin, "stat"),
		"#!/bin/sh\necho 'stat: forced timestamp-read failure' >&2\nexit 1\n",
	);

	const { rows } = runAudit(fixture);
	const row = rowFor(rows, fixture.worktree);

	expect(row.bucket).not.toBe("safe");
	expect(row.bucket).toBe("verify-recent-chat");
});
