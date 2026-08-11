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
 *     timestamp-read failure must be fail-closed / not-safe (not recent=no);
 *     matching session header read/jq parse failure and transcript find/
 *     traversal failure must also be fail-closed / not-safe (verify-recent-chat,
 *     unknown, or explicit nonzero failure);
 *     ordinary non-transcript files under sessions must be ignored (only .jsonl
 *     candidates are parsed) and must not poison an otherwise safe/review row;
 *     a confirmed-absent sessions path means no transcripts, but an existing
 *     non-directory or inaccessible/unsearchable sessions path must fail closed;
 *     a valid sessions-root symlink to a directory that holds a matching recent
 *     .jsonl must still be discovered (verify-recent-chat / not-safe), not skipped
 *     by plain find -P traversal of the symlink root.
 *
 * No network, GitHub, or real user state.
 */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const AUDIT_SCRIPT = join(
	REPO_ROOT,
	"skills/poteto-mode/scripts/worktree-audit.sh",
);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FAIL_CLOSED_BUCKETS = new Set(["verify-recent-chat", "unknown"]);

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

type AuditResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	rows: AuditRow[];
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


function writeNonTranscriptSessionArtifacts(home: string): void {
	const sessions = join(home, ".omp", "agent", "sessions");
	mkdirSync(join(sessions, "notes-dir"), { recursive: true });
	// Ordinary clutter under sessions: must never be treated as transcript
	// candidates, or jq/header parse failures poison otherwise-safe rows.
	writeFileSync(join(sessions, "debug.log"), "not a transcript\n", "utf8");
	writeFileSync(join(sessions, "readme.md"), "# not a transcript\n", "utf8");
	writeFileSync(join(sessions, "notes-dir", "scratch.txt"), "still noise\n", "utf8");
}


function writeMatchingTranscriptViaSessionsSymlink(
	home: string,
	cwd: string,
	root: string,
): string {
	const agent = join(home, ".omp", "agent");
	mkdirSync(agent, { recursive: true });

	// Real transcript directory lives outside the sessions path; sessions itself
	// is only a symlink. Plain find -P accepts -d on the symlink but does not
	// traverse into the target, which would miss recent chats and fail open.
	const realSessions = join(root, "real-sessions");
	const sessionDir = join(realSessions, "portability-session");
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
	symlinkSync(realSessions, join(agent, "sessions"));
	return transcript;
}

function writeSessionsAsNonDirectory(home: string): void {
	const agent = join(home, ".omp", "agent");
	mkdirSync(agent, { recursive: true });
	writeFileSync(join(agent, "sessions"), "unexpected file, not a sessions directory\n", "utf8");
}

function runAudit(fixture: Fixture): AuditResult {
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
	const exitCode = result.exitCode ?? 1;

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

	return { exitCode, stdout, stderr, rows };
}

function rowFor(rows: AuditRow[], worktree: string): AuditRow {
	const row = rows.find((r) => r.worktree === worktree);
	expect(row).toBeDefined();
	return row as AuditRow;
}

/** Fail-closed: explicit nonzero exit, or not-safe verify-recent-chat/unknown. */
function expectFailClosedNotSafe(result: AuditResult, worktree: string): void {
	if (result.exitCode !== 0) {
		expect(result.exitCode).not.toBe(0);
		return;
	}

	const row = rowFor(result.rows, worktree);
	expect(row.bucket).not.toBe("safe");
	expect(FAIL_CLOSED_BUCKETS.has(row.bucket)).toBe(true);
}

test("recent matching transcript on GNU/Linux is detected as verify-recent-chat", () => {
	const fixture = createFixture({ merged: false });
	writeMatchingTranscript(fixture.home, fixture.worktree);

	const result = runAudit(fixture);
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);

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

	const result = runAudit(fixture);
	expectFailClosedNotSafe(result, fixture.worktree);
});

test("matching session header jq parse failure is fail-closed / not-safe", () => {
	const fixture = createFixture({ merged: true });
	writeMatchingTranscript(fixture.home, fixture.worktree);

	// Matching session header is present, but jq is unavailable/nonzero.
	// Swallowing that as "no transcript" is fail-open for a merged worktree.
	writeExecutable(
		join(fixture.bin, "jq"),
		"#!/bin/sh\necho 'jq: forced unavailable/nonzero' >&2\nexit 2\n",
	);

	expectFailClosedNotSafe(runAudit(fixture), fixture.worktree);
});

test("session transcript find/traversal failure is fail-closed / not-safe", () => {
	const fixture = createFixture({ merged: true });
	writeMatchingTranscript(fixture.home, fixture.worktree);

	// Sessions exist for the candidate cwd, but discovery/traversal fails.
	// Treating that as recent=no would incorrectly mark a merged tree safe.
	writeExecutable(
		join(fixture.bin, "find"),
		"#!/bin/sh\necho 'find: forced traversal failure' >&2\nexit 1\n",
	);

	expectFailClosedNotSafe(runAudit(fixture), fixture.worktree);
});

test("non-transcript session artifacts are ignored for an otherwise safe candidate", () => {
	const fixture = createFixture({ merged: true });
	writeNonTranscriptSessionArtifacts(fixture.home);

	const result = runAudit(fixture);
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);

	// .log/.md/dir clutter is not a transcript. Parsing it must not flip an
	// otherwise-safe merged candidate into verify-recent-chat/unknown.
	expect(row.bucket).toBe("safe");
	expect(row.lastChat).toBe("-");
});

test("existing non-directory sessions path is fail-closed / not-safe", () => {
	const fixture = createFixture({ merged: true });
	writeSessionsAsNonDirectory(fixture.home);

	// Path exists but is not a directory: skipping discovery would fail open
	// as "no transcripts" → safe. Absent path is the only no-transcript case.
	expectFailClosedNotSafe(runAudit(fixture), fixture.worktree);
});

test("confirmed-absent sessions path means no transcripts / stays safe when merged", () => {
	const fixture = createFixture({ merged: true });
	// Do not create ~/.omp/agent/sessions at all.
	const result = runAudit(fixture);
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);
	expect(row.bucket).toBe("safe");
	expect(row.lastChat).toBe("-");
});

test("sessions-root symlink with matching recent transcript is verify-recent-chat", () => {
	const fixture = createFixture({ merged: true });
	writeMatchingTranscriptViaSessionsSymlink(
		fixture.home,
		fixture.worktree,
		fixture.root,
	);

	// -d succeeds on a directory symlink, but discovery that does not traverse
	// the symlink root would miss the transcript and fail open as safe.
	const result = runAudit(fixture);
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);
	expect(row.bucket).toBe("verify-recent-chat");
	expect(row.lastChat).toMatch(DATE_RE);
});
