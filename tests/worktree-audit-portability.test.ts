/**
 * Public seam:
 *   skills/poteto-mode/scripts/worktree-audit.sh
 * executed as a real subprocess against an isolated temporary
 * HOME / session-transcript / git-worktree fixture on Linux.
 *
 * Independent sources of truth:
 *   - worktree-cleanup playbook buckets (verify-recent-chat vs safe)
 *   - OMP session header shape: {"type":"session",...,"cwd":"<path>"}
 *   - active agent_dir from `omp config path` (named profiles: sessions under
 *     <agent_dir>/sessions); applicable named-profile XDG data root
 *     $XDG_DATA_HOME/omp/profiles/<profile>/sessions (OMP_PROFILE canonical,
 *     PI_PROFILE fallback) without default-profile leakage; omp config path
 *     failure is fail-closed
 *   - acceptance: recent matching transcript must be detected on GNU/Linux;
 *     timestamp-read failure must be fail-closed / not-safe (not recent=no);
 *     matching session header read/jq parse failure and transcript find/
 *     traversal failure must also be fail-closed / not-safe (verify-recent-chat,
 *     unknown, or explicit nonzero failure);
 *     syntactically valid but non-session / wrong-shape first-line JSONL headers
 *     are fail-closed / not-safe (not empty-skip);
 *     recent session cwd equal to the worktree OR a descendant path
 *     ($wt/packages/app) counts; sibling-prefix (${wt}-other) does not
 *     (path-separator boundary);
 *     ordinary non-transcript files under sessions must be ignored (only .jsonl
 *     candidates are parsed) and must not poison an otherwise safe/review row;
 *     a confirmed-absent sessions path means no transcripts, but an existing
 *     non-directory or inaccessible/unsearchable sessions path must fail closed;
 *     a valid sessions-root symlink to a directory that holds a matching recent
 *     .jsonl must still be discovered (verify-recent-chat / not-safe), not skipped
 *     by plain find -P traversal of the symlink root;
 *     git worktree porcelain paths containing spaces must be parsed as the full
 *     path (not awk $2 / truncated) and classified;
 *     size sorting must work without GNU sort -h (BSD/macOS) while retaining
 *     descending size order;
 *     missing/unauthenticated/nonzero gh pr list must not become [] → safe
 *     (nonzero exit, or PR unknown / non-safe).
 *
 * No network, GitHub, or real user state. Fixtures never inspect real sessions.
 */
import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
	size: string;
	pr: string;
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

type AuditEnv = {
	XDG_DATA_HOME?: string;
	OMP_PROFILE?: string;
	PI_PROFILE?: string;
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

function createFixture(options: {
	merged: boolean;
	worktreeDirName?: string;
}): Fixture {
	const root = mkdtempSync(join(tmpdir(), "worktree-audit-portability-"));
	fixtures.push(root);

	const home = join(root, "home");
	const repo = join(root, "repo");
	const worktree = join(root, options.worktreeDirName ?? "wt-candidate");
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

/** Two sized candidates for portable descending-size sort assertions. */
function createSizedCandidatesFixture(): Fixture & {
	largeWorktree: string;
	smallWorktree: string;
} {
	const root = mkdtempSync(join(tmpdir(), "worktree-audit-portability-"));
	fixtures.push(root);

	const home = join(root, "home");
	const repo = join(root, "repo");
	const largeWorktree = join(root, "wt-large");
	const smallWorktree = join(root, "wt-small");
	const bin = join(root, "bin");
	mkdirSync(home, { recursive: true });
	mkdirSync(repo, { recursive: true });
	mkdirSync(bin, { recursive: true });

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
	sh(`git worktree add -q -b large "${largeWorktree}" HEAD`, repo, gitEnv);
	sh(`git worktree add -q -b small "${smallWorktree}" HEAD`, repo, gitEnv);
	sh(
		`git update-ref refs/remotes/origin/main "$(git rev-parse HEAD)"`,
		repo,
		gitEnv,
	);

	// Independent size signal for du(1): large blob vs tiny file (untracked is fine).
	writeFileSync(join(largeWorktree, "blob.bin"), "L".repeat(2 * 1024 * 1024), "utf8");
	writeFileSync(join(smallWorktree, "tiny.txt"), "s\n", "utf8");

	return {
		root,
		home,
		repo,
		worktree: largeWorktree,
		bin,
		largeWorktree,
		smallWorktree,
	};
}

/** Reject GNU-only sort -h / -rh the way BSD/macOS sort does. */
function installBsdSortStub(bin: string): void {
	writeExecutable(
		join(bin, "sort"),
		`#!/bin/sh
for arg in "$@"; do
	case "$arg" in
		-h|--human-numeric-sort)
			echo "sort: invalid option -- h" >&2
			exit 2
			;;
		-*[!0-9kKtTbBnRrmu]*h*|-*h*)
			# Combined flags such as -rh / -hr (GNU human-numeric).
			echo "sort: invalid option -- h" >&2
			exit 2
			;;
	esac
done
exec /usr/bin/sort "$@"
`,
	);
}

/** Stub `omp config path` to a fixture-local agent_dir (never real user state). */
function installOmpConfigPathStub(bin: string, agentDir: string): void {
	writeExecutable(
		join(bin, "omp"),
		`#!/bin/sh
if [ "$1" = "config" ] && [ "$2" = "path" ]; then
	printf '%s\\n' "${agentDir}"
	exit 0
fi
echo "omp stub: unexpected invocation: $*" >&2
exit 1
`,
	);
}

/** Force `omp config path` to fail closed at the process boundary. */
function installOmpConfigPathFailureStub(bin: string): void {
	writeExecutable(
		join(bin, "omp"),
		`#!/bin/sh
echo "omp: forced config path failure" >&2
exit 1
`,
	);
}

function writeSessionTranscript(
	sessionsRoot: string,
	cwd: string,
	options: {
		id?: string;
		header?: Record<string, unknown>;
	} = {},
): string {
	const id = options.id ?? "portability-session";
	const sessionDir = join(sessionsRoot, id);
	mkdirSync(sessionDir, { recursive: true });
	const transcript = join(sessionDir, "session.jsonl");
	const header =
		options.header ??
		({
			type: "session",
			version: 3,
			id,
			timestamp: "2026-08-11T12:00:00.000Z",
			cwd,
		} satisfies Record<string, unknown>);
	writeFileSync(transcript, `${JSON.stringify(header)}\n`, "utf8");
	return transcript;
}

function writeMatchingTranscript(home: string, cwd: string): string {
	return writeSessionTranscript(join(home, ".omp", "agent", "sessions"), cwd);
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
	const transcript = writeSessionTranscript(realSessions, cwd);
	symlinkSync(realSessions, join(agent, "sessions"));
	return transcript;
}

function writeSessionsAsNonDirectory(home: string): void {
	const agent = join(home, ".omp", "agent");
	mkdirSync(agent, { recursive: true });
	writeFileSync(join(agent, "sessions"), "unexpected file, not a sessions directory\n", "utf8");
}

function runAudit(fixture: Fixture, auditEnv: AuditEnv = {}): AuditResult {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: fixture.home,
		PATH: `${fixture.bin}:${process.env.PATH ?? ""}`,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
	};
	// Never inherit real user profile / XDG roots; only fixture-local overrides.
	delete env.XDG_DATA_HOME;
	delete env.OMP_PROFILE;
	delete env.PI_PROFILE;
	delete env.PI_CODING_AGENT_DIR;
	if (auditEnv.XDG_DATA_HOME !== undefined) {
		env.XDG_DATA_HOME = auditEnv.XDG_DATA_HOME;
	}
	if (auditEnv.OMP_PROFILE !== undefined) {
		env.OMP_PROFILE = auditEnv.OMP_PROFILE;
	}
	if (auditEnv.PI_PROFILE !== undefined) {
		env.PI_PROFILE = auditEnv.PI_PROFILE;
	}

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
				size: cols[0] ?? "",
				pr: cols[5] ?? "",
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

	// Matching session header is present, but the later header-cwd jq query
	// fails. A blanket jq failure would trip the earlier PR-array validation
	// instead, so keep that path succeeding and only fail the session-header
	// extract — recording a fixture-local marker so a never-attempted header
	// parse cannot pass. Swallowing header failure as "no transcript" is
	// fail-open for a merged worktree.
	const marker = join(fixture.root, "jq-session-header-parse-failed");
	writeExecutable(
		join(fixture.bin, "jq"),
		`#!/bin/sh
for arg in "$@"; do
	case "$arg" in
		*'select(.type == "session")'*)
			: > "${marker}"
			echo 'jq: forced session-header parse failure' >&2
			exit 2
			;;
	esac
done
exit 0
`,
	);

	const result = runAudit(fixture);
	expect(existsSync(marker)).toBe(true);
	expectFailClosedNotSafe(result, fixture.worktree);
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

test("worktree porcelain paths with spaces are parsed and classified in full", () => {
	const fixture = createFixture({
		merged: true,
		worktreeDirName: "wt candidate spaced",
	});
	expect(fixture.worktree.includes(" ")).toBe(true);

	// awk '{print $2}' truncates at the first space, so the full porcelain path
	// never appears as WORKTREE and cannot be classified.
	const result = runAudit(fixture);
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);
	expect(row.worktree).toBe(fixture.worktree);
	expect(row.bucket).toBe("safe");
});

test("size sort works without GNU sort -h and keeps descending order", () => {
	const fixture = createSizedCandidatesFixture();
	installBsdSortStub(fixture.bin);

	const result = runAudit(fixture);
	expect(result.exitCode).toBe(0);

	const large = rowFor(result.rows, fixture.largeWorktree);
	const small = rowFor(result.rows, fixture.smallWorktree);
	expect(result.rows.map((r) => r.worktree)).toEqual([
		fixture.largeWorktree,
		fixture.smallWorktree,
	]);
	// Human SIZE labels may differ by du(1); relative order is the contract.
	expect(large.size.length).toBeGreaterThan(0);
	expect(small.size.length).toBeGreaterThan(0);
});

test("nonzero gh pr list is fail-closed / not fabricated [] → safe", () => {
	const fixture = createFixture({ merged: true });

	// Unauthenticated / nonzero gh. Current script replaces failure with [] and
	// a merged worktree then buckets safe — that is fail-open.
	writeExecutable(
		join(fixture.bin, "gh"),
		"#!/bin/sh\necho 'gh: To get started with GitHub CLI, please run: gh auth login' >&2\nexit 1\n",
	);

	const result = runAudit(fixture);
	if (result.exitCode !== 0) {
		expect(result.exitCode).not.toBe(0);
		return;
	}

	const row = rowFor(result.rows, fixture.worktree);
	expect(row.bucket).not.toBe("safe");
	// If the script continues, PR must be explicitly unknown/non-empty-safe — not
	// the fabricated "-" that comes from rewriting a failed gh call as [].
	expect(row.pr).not.toBe("-");
});

test("named-profile agent_dir from omp config path is scanned for recent sessions", () => {
	const fixture = createFixture({ merged: true });
	// Fixture-local agent_dir outside the hardcoded default ~/.omp/agent root.
	const agentDir = join(fixture.root, "named-agent-from-omp");
	installOmpConfigPathStub(fixture.bin, agentDir);
	writeSessionTranscript(join(agentDir, "sessions"), fixture.worktree, {
		id: "named-profile-session",
	});

	const result = runAudit(fixture);
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);
	// Hardcoded default-only roots miss this transcript and fail open as safe.
	expect(row.bucket).toBe("verify-recent-chat");
	expect(row.lastChat).toMatch(DATE_RE);
});

test("named-profile XDG sessions are scanned without default-profile leakage", () => {
	const fixture = createFixture({ merged: true });
	const profile = "auditprof";
	const xdgDataHome = join(fixture.root, "xdg-data");
	const profileSessions = join(
		xdgDataHome,
		"omp",
		"profiles",
		profile,
		"sessions",
	);
	const defaultSessions = join(xdgDataHome, "omp", "sessions");
	const agentDir = join(fixture.home, ".omp", "profiles", profile, "agent");

	// Applicable named-profile XDG root must already exist (OMP profile semantics).
	mkdirSync(join(xdgDataHome, "omp", "profiles", profile), { recursive: true });
	mkdirSync(defaultSessions, { recursive: true });
	installOmpConfigPathStub(fixture.bin, agentDir);

	// Only the named-profile XDG root holds the matching recent session.
	writeSessionTranscript(profileSessions, fixture.worktree, {
		id: "xdg-profile-session",
	});

	const result = runAudit(fixture, {
		XDG_DATA_HOME: xdgDataHome,
		OMP_PROFILE: profile,
	});
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);
	expect(row.bucket).toBe("verify-recent-chat");
	expect(row.lastChat).toMatch(DATE_RE);
});

test("default-profile XDG sessions do not leak into named-profile audit", () => {
	const fixture = createFixture({ merged: true });
	const profile = "auditprof";
	const xdgDataHome = join(fixture.root, "xdg-data");
	const profileSessions = join(
		xdgDataHome,
		"omp",
		"profiles",
		profile,
		"sessions",
	);
	const defaultSessions = join(xdgDataHome, "omp", "sessions");
	const agentDir = join(fixture.home, ".omp", "profiles", profile, "agent");

	mkdirSync(join(xdgDataHome, "omp", "profiles", profile), { recursive: true });
	mkdirSync(profileSessions, { recursive: true });
	installOmpConfigPathStub(fixture.bin, agentDir);

	// Matching recent chat lives only under the default-profile XDG root.
	writeSessionTranscript(defaultSessions, fixture.worktree, {
		id: "default-profile-leak",
	});

	const result = runAudit(fixture, {
		XDG_DATA_HOME: xdgDataHome,
		OMP_PROFILE: profile,
	});
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);
	// Named-profile scans must not inherit default-profile sessions.
	expect(row.bucket).toBe("safe");
	expect(row.lastChat).toBe("-");
});

test("PI_PROFILE fallback selects named-profile XDG sessions when OMP_PROFILE unset", () => {
	const fixture = createFixture({ merged: true });
	const profile = "legacyprof";
	const xdgDataHome = join(fixture.root, "xdg-data");
	const profileSessions = join(
		xdgDataHome,
		"omp",
		"profiles",
		profile,
		"sessions",
	);
	const agentDir = join(fixture.home, ".omp", "profiles", profile, "agent");

	mkdirSync(join(xdgDataHome, "omp", "profiles", profile), { recursive: true });
	installOmpConfigPathStub(fixture.bin, agentDir);
	writeSessionTranscript(profileSessions, fixture.worktree, {
		id: "pi-profile-session",
	});

	const result = runAudit(fixture, {
		XDG_DATA_HOME: xdgDataHome,
		PI_PROFILE: profile,
	});
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);
	expect(row.bucket).toBe("verify-recent-chat");
	expect(row.lastChat).toMatch(DATE_RE);
});

test("omp config path failure is fail-closed / not-safe", () => {
	const fixture = createFixture({ merged: true });
	installOmpConfigPathFailureStub(fixture.bin);

	// Real jq remains on PATH so PR-array validation still succeeds and the
	// audit reaches the session-root resolution path.
	expectFailClosedNotSafe(runAudit(fixture), fixture.worktree);
});

test("syntactically valid non-session jsonl header is fail-closed / not empty-skip", () => {
	const fixture = createFixture({ merged: true });
	// Valid JSON, wrong shape: not a session header. Empty-skip would treat this
	// as "no transcript" and fail open to safe on a merged candidate.
	writeSessionTranscript(join(fixture.home, ".omp", "agent", "sessions"), fixture.worktree, {
		id: "wrong-shape-header",
		header: {
			type: "message",
			role: "user",
			cwd: fixture.worktree,
			text: "not a session header",
		},
	});

	expectFailClosedNotSafe(runAudit(fixture), fixture.worktree);
});

test("recent session cwd in worktree descendant prevents safe", () => {
	const fixture = createFixture({ merged: true });
	const descendantCwd = join(fixture.worktree, "packages", "app");
	mkdirSync(descendantCwd, { recursive: true });
	writeMatchingTranscript(fixture.home, descendantCwd);

	const result = runAudit(fixture);
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);
	// Exact-only cwd compare misses $wt/packages/app and fails open as safe.
	expect(row.bucket).toBe("verify-recent-chat");
	expect(row.lastChat).toMatch(DATE_RE);
});

test("recent session cwd with sibling-prefix path does not prevent safe", () => {
	const fixture = createFixture({ merged: true });
	const siblingCwd = `${fixture.worktree}-other`;
	mkdirSync(siblingCwd, { recursive: true });
	writeMatchingTranscript(fixture.home, siblingCwd);

	const result = runAudit(fixture);
	expect(result.exitCode).toBe(0);
	const row = rowFor(result.rows, fixture.worktree);
	// Path-separator boundary: ${wt}-other is not $wt or a descendant of $wt.
	expect(row.bucket).toBe("safe");
	expect(row.lastChat).toBe("-");
});
