#!/usr/bin/env bash
# Read-only worktree prune audit. Classifies every git worktree by size, merge
# state, uncommitted work, remote/PR state, and the most recent chat that
# operated in it. Emits a table sorted by size with a suggested bucket. Never
# deletes anything; deletion stays a human-gated step in the playbook.
#
# Usage: worktree-audit.sh [repo-path]   (defaults to the current repo)
set -u

repo="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$repo" ] && { echo "not in a git repo; pass a repo path" >&2; exit 1; }
cd "$repo" || exit 1

# Main worktree is the first entry; everything else is a candidate.
main_wt=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')

# origin/main drives the merge check. Best-effort; stale is fine for a first pass.
git fetch origin main --quiet 2>/dev/null || echo "warn: could not fetch origin/main; merged column may be stale" >&2

# PR state by branch, fetched once. Empty if gh is unavailable.
prs=$(mktemp)
gh pr list --author "@me" --state all --limit 1000 \
	--json number,state,headRefName 2>/dev/null > "$prs" || echo "[]" > "$prs"

# OMP sessions are global; each JSONL header carries the authoritative cwd.
if [ -n "${XDG_DATA_HOME:-}" ]; then
	transcripts="$XDG_DATA_HOME/omp/sessions"
else
	transcripts="$HOME/.omp/agent/sessions"
fi

# Materialize transcript discovery so find's exit status is not hidden by
# process substitution. Only JSONL files are session transcripts; parsing
# unrelated artifacts would turn harmless clutter into an unsafe parse error.
# A partial/failed traversal is unsafe because it may omit the only transcript
# matching a candidate worktree.
session_candidates=$(mktemp) || {
	rm -f "$prs"
	echo "could not create transcript candidate list" >&2
	exit 1
}
session_discovery_failed=no
if [ -d "$transcripts" ]; then
	if ! find "$transcripts" -type f -name '*.jsonl' -print0 > "$session_candidates"; then
		session_discovery_failed=yes
	fi
elif [ -e "$transcripts" ] || [ -L "$transcripts" ]; then
	# Existing non-directories and dangling links are not an empty session store.
	session_discovery_failed=yes
else
	# Confirm absence through the nearest existing ancestor. A failed stat below
	# an unsearchable ancestor is indistinguishable from absence unless the
	# ancestor's search permission is checked explicitly.
	probe=$transcripts
	while :; do
		parent=${probe%/*}
		[ "$parent" = "$probe" ] && {
			session_discovery_failed=yes
			break
		}
		[ -z "$parent" ] && parent=/
		if [ -d "$parent" ]; then
			[ -x "$parent" ] || session_discovery_failed=yes
			break
		fi
		if [ -e "$parent" ] || [ -L "$parent" ]; then
			session_discovery_failed=yes
			break
		fi
		probe=$parent
	done
fi
now=$(date +%s 2>/dev/null || echo 0)
case "$now" in ''|*[!0-9]*) now=0 ;; esac

# GNU and BSD/macOS spell mtime reads and epoch formatting differently.
# Detect the available forms once instead of assuming the host OS.
if stat -c '%Y' -- "$repo" >/dev/null 2>&1; then
	stat_style=gnu
elif stat -f '%m' "$repo" >/dev/null 2>&1; then
	stat_style=bsd
else
	stat_style=unknown
fi

if date -d '@0' '+%Y-%m-%d' >/dev/null 2>&1; then
	date_style=gnu
elif date -r 0 '+%Y-%m-%d' >/dev/null 2>&1; then
	date_style=bsd
else
	date_style=unknown
fi

file_mtime() {
	case "$stat_style" in
		gnu) stat -c '%Y' -- "$1" ;;
		bsd) stat -f '%m' "$1" ;;
		*) return 1 ;;
	esac
}

format_epoch_day() {
	case "$date_style" in
		gnu) date -d "@$1" '+%Y-%m-%d' ;;
		bsd) date -r "$1" '+%Y-%m-%d' ;;
		*) return 1 ;;
	esac
}

printf "SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE\n"

git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
	[ "$wt" = "$main_wt" ] && continue

	size=$(du -sh "$wt" 2>/dev/null | awk '{print $1}')
	head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
	head_ts=$(git -C "$wt" log -1 --format='%ct' HEAD 2>/dev/null || echo 0)
	age=$([ "$head_ts" -gt 0 ] 2>/dev/null && echo "$(( (now - head_ts) / 86400 ))d" || echo "?")

	# Squash-merged branches are not ancestors of main, so PR state is the
	# real signal; merge-base only catches fast-forward/rebase merges.
	git merge-base --is-ancestor "$head" origin/main 2>/dev/null && merged=YES || merged=no

	# Distinguish real WIP (tracked edits) from disposable untracked scratch.
	porcelain=$(git -C "$wt" status --porcelain 2>/dev/null)
	if [ -z "$porcelain" ]; then dirty=clean
	elif printf '%s\n' "$porcelain" | grep -qv '^??'; then
		dirty="wip:$(printf '%s\n' "$porcelain" | grep -cv '^??')"
	else dirty="scratch:$(printf '%s\n' "$porcelain" | grep -c '^??')"; fi

	branch=$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
	if [ -z "$branch" ]; then remote=detached
	elif git -C "$wt" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
		[ "$(git -C "$wt" rev-parse "origin/$branch" 2>/dev/null)" = "$head" ] \
			&& remote=pushed \
			|| remote="ahead$(git -C "$wt" rev-list --count "origin/$branch..HEAD" 2>/dev/null)"
	else remote=no-remote; fi

	pr=$([ -n "$branch" ] && jq -r --arg b "$branch" \
		'.[] | select(.headRefName==$b) | "#\(.number)/\(.state)"' "$prs" 2>/dev/null | head -1)
	[ -z "$pr" ] && pr="-"

	# Most recent chat whose first-line session header names this worktree.
	# Parse only the header and compare cwd exactly so sibling paths and later
	# transcript content do not match.
	last="-"; last_ts=0; transcript_match=no; timestamp_failed=no
	transcript_scan_failed=$session_discovery_failed
	while IFS= read -r -d '' candidate; do
		header=""
		IFS= read -r header < "$candidate"
		header_status=$?
		if [ "$header_status" -ne 0 ] && [ -z "$header" ]; then
			transcript_scan_failed=yes
			continue
		fi

		# Check jq in this shell. An unparseable header could belong to this
		# worktree, so treating it as a non-match would fail open.
		if ! header_cwd=$(printf '%s\n' "$header" \
			| jq -r 'select(.type == "session") | .cwd // empty' 2>/dev/null); then
			transcript_scan_failed=yes
			continue
		fi
		[ "$header_cwd" = "$wt" ] || continue
		transcript_match=yes

		if candidate_ts=$(file_mtime "$candidate" 2>/dev/null); then
			case "$candidate_ts" in
				''|*[!0-9]*) timestamp_failed=yes ;;
				*) [ "$candidate_ts" -gt "$last_ts" ] && last_ts=$candidate_ts ;;
			esac
		else
			timestamp_failed=yes
		fi
	done < "$session_candidates"

	if [ "$last_ts" -gt 0 ]; then
		if ! last=$(format_epoch_day "$last_ts" 2>/dev/null) || [ -z "$last" ]; then
			last="-"
			timestamp_failed=yes
		fi
	fi

	if [ "$transcript_scan_failed" = yes ]; then
		recent=unknown
	elif [ "$transcript_match" = yes ] && { [ "$timestamp_failed" = yes ] || [ "$now" -le 0 ]; }; then
		recent=unknown
	elif [ "$last_ts" -gt 0 ] && [ $(( (now - last_ts) / 86400 )) -le 4 ]; then
		recent=yes
	else
		recent=no
	fi

	case "$dirty" in wip:*) bucket=hold-wip ;; *)
		case "$pr" in *OPEN*) bucket=hold-open-pr ;; *)
			if [ "$recent" != no ]; then bucket=verify-recent-chat
			elif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe
			else bucket=review; fi ;;
		esac ;;
	esac

	printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
		"$size" "$age" "$merged" "$dirty" "$remote" "$pr" "$last" "$bucket" "$wt"
done | sort -t$'\t' -k1,1 -rh

rm -f "$prs" "$session_candidates"
