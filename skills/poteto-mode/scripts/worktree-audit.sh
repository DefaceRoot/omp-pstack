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

# Lexically normalize an agent-directory path like Node's path.resolve().
# Do not resolve symlinks: DirResolver's isDefault check compares normalized
# path spellings, not filesystem identities.
normalize_path() {
	local input=$1 segment result depth
	local -a parts normalized
	parts=()
	normalized=()

	case "$input" in
		/*) ;;
		*) input="$(pwd -P)/$input" ;;
	esac
	IFS=/ read -r -a parts <<< "$input"
	for segment in "${parts[@]}"; do
		case "$segment" in
			""|.) ;;
			..)
				depth=${#normalized[@]}
				[ "$depth" -gt 0 ] && unset 'normalized[depth-1]'
				;;
			*) normalized[${#normalized[@]}]=$segment ;;
		esac
	done
	result=
	for segment in "${normalized[@]}"; do
		result="$result/$segment"
	done
	printf '%s\n' "${result:-/}"
}

# Main worktree is the first entry. Strip the porcelain record prefix rather
# than splitting on whitespace because worktree paths may contain spaces.
main_wt=$(git worktree list --porcelain \
	| sed -n '/^worktree /{s/^worktree //;p;q;}')

# origin/main drives the merge check. Best-effort; stale is fine for a first pass.
git fetch origin main --quiet 2>/dev/null || echo "warn: could not fetch origin/main; merged column may be stale" >&2

# PR state by branch, fetched once. Without a complete response the audit
# cannot prove that a merged worktree has no open PR, so fail closed.
pr_pages=$(mktemp) || {
	echo "could not create PR-page file" >&2
	exit 1
}
prs=$(mktemp) || {
	rm -f "$pr_pages"
	echo "could not create PR-state file" >&2
	exit 1
}
if ! gh api --paginate --slurp \
	'repos/{owner}/{repo}/pulls?state=open&per_page=100' > "$pr_pages"; then
	rm -f "$pr_pages" "$prs"
	echo "could not query GitHub PR state; refusing to classify worktrees" >&2
	exit 1
fi
if ! jq -e '
	if type != "array" then error("invalid paginated PR response")
	else [
		.[] | if type == "array" then .[] else . end
		| {
			number: (
				if (.number | type) == "number" then .number
				else error("invalid PR number")
				end
			),
			state: (
				if (.state | type) == "string" and (.state | ascii_upcase) == "OPEN"
				then "OPEN"
				else error("invalid PR state")
				end
			),
			headRefName: (
				if (.headRefName? | type) == "string" then .headRefName
				elif (.head?.ref? | type) == "string" then .head.ref
				else error("invalid PR head ref")
				end
			)
		}
	] end
' "$pr_pages" > "$prs"; then
	rm -f "$pr_pages" "$prs"
	echo "could not parse GitHub PR state; refusing to classify worktrees" >&2
	exit 1
fi

# Ask OMP exactly once for the active profile's agent directory. Its answer is
# authoritative; falling back after a command or parse failure could inspect a
# real default-profile session store while another profile is active.
if ! agent_dir_output=$(omp config path); then
	rm -f "$pr_pages" "$prs"
	echo "could not resolve the active OMP agent directory; refusing to classify worktrees" >&2
	exit 1
fi
case "$agent_dir_output" in
	*$'\n'*)
		rm -f "$pr_pages" "$prs"
		echo "could not parse the active OMP agent directory; refusing to classify worktrees" >&2
		exit 1
		;;
esac
if ! agent_dir=$(printf '%s\n' "$agent_dir_output" \
	| sed 's/^[[:space:]]*//;s/[[:space:]]*$//') || [ -z "$agent_dir" ]; then
	rm -f "$pr_pages" "$prs"
	echo "could not parse the active OMP agent directory; refusing to classify worktrees" >&2
	exit 1
fi
case "$agent_dir" in
	/*) ;;
	*)
		rm -f "$pr_pages" "$prs"
		echo "active OMP agent directory is not absolute; refusing to classify worktrees" >&2
		exit 1
		;;
esac

# OMP_PROFILE is canonical even when explicitly set to empty; PI_PROFILE is
# only the compatibility fallback when OMP_PROFILE is absent. Match OMP's
# normalizeProfileName contract before deriving any profile-scoped path.
if [ "${OMP_PROFILE+x}" = x ]; then
	raw_profile=$OMP_PROFILE
elif [ "${PI_PROFILE+x}" = x ]; then
	raw_profile=$PI_PROFILE
else
	raw_profile=
fi
if ! active_profile=$(printf '%s\n' "$raw_profile" \
	| sed 's/^[[:space:]]*//;s/[[:space:]]*$//'); then
	rm -f "$pr_pages" "$prs"
	echo "could not normalize OMP profile name; refusing to classify worktrees" >&2
	exit 1
fi
[ "$active_profile" = default ] && active_profile=
if [ -n "$active_profile" ]; then
	if [[ ! "$active_profile" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]]; then
		rm -f "$pr_pages" "$prs"
		echo "invalid OMP profile name; refusing to classify worktrees" >&2
		exit 1
	fi
	case "$active_profile" in
		*.|con|con.*|prn|prn.*|aux|aux.*|nul|nul.*|com[0-9]|com[0-9].*|lpt[0-9]|lpt[0-9].*)
			rm -f "$pr_pages" "$prs"
			echo "invalid OMP profile name; refusing to classify worktrees" >&2
			exit 1
			;;
	esac
fi

session_discovery_failed=no
session_roots=("$agent_dir/sessions")

# DirResolver consults XDG only on Linux/macOS and only while the active agent
# directory is the profile-derived default. Named profiles ignore an inherited
# PI_CODING_AGENT_DIR, and default mode without an override is semantically
# default regardless of equivalent HOME/PI_CONFIG_DIR path spellings.
is_default_agent=no
if [ -n "$active_profile" ] \
	|| [ "${PI_CODING_AGENT_DIR+x}" != x ] \
	|| [ -z "$PI_CODING_AGENT_DIR" ]; then
	is_default_agent=yes
else
	config_dir_name=${PI_CONFIG_DIR:-.omp}
	profile_default_agent=$(normalize_path "$HOME/$config_dir_name/agent")
	normalized_agent_dir=$(normalize_path "$agent_dir")
	[ "$normalized_agent_dir" = "$profile_default_agent" ] && is_default_agent=yes
fi

xdg_applicable=no
if [ "$is_default_agent" = yes ] \
	&& [ "${XDG_DATA_HOME+x}" = x ] \
	&& [ -n "$XDG_DATA_HOME" ]; then
	if platform_name=$(uname -s 2>/dev/null); then
		case "$platform_name" in
			Linux|Darwin) xdg_applicable=yes ;;
		esac
	else
		session_discovery_failed=yes
	fi
fi

if [ "$xdg_applicable" = yes ]; then
	xdg_data_home=$XDG_DATA_HOME
	case "$xdg_data_home" in
		/*) ;;
		*)
			rm -f "$pr_pages" "$prs"
			echo "XDG_DATA_HOME is not absolute; refusing to classify worktrees" >&2
			exit 1
			;;
	esac

	if [ -n "$active_profile" ]; then
		xdg_profile_root="$xdg_data_home/omp/profiles/$active_profile"
	else
		xdg_profile_root="$xdg_data_home/omp"
	fi
	if [ -d "$xdg_profile_root" ] || [ -e "$xdg_profile_root" ] || [ -L "$xdg_profile_root" ]; then
		session_roots+=("$xdg_profile_root/sessions")
	else
		# An explicitly configured XDG root is optional only when its absence
		# can be confirmed through a searchable existing ancestor.
		probe=$xdg_profile_root
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
fi
# Materialize discovery across every applicable root so find failures are not
# hidden by process substitution. Canonicalizing existing roots deduplicates
# agent/XDG aliases and follows a command-line sessions-root symlink without
# following symlinks discovered beneath it.
session_candidates=$(mktemp) || {
	rm -f "$pr_pages" "$prs"
	echo "could not create transcript candidate list" >&2
	exit 1
}
resolved_session_roots=()
for transcripts in "${session_roots[@]}"; do
	if [ -d "$transcripts" ]; then
		if ! resolved=$(CDPATH= cd -P -- "$transcripts" 2>/dev/null && pwd -P); then
			session_discovery_failed=yes
			resolved=$transcripts
		fi
	else
		resolved=$transcripts
	fi

	duplicate=no
	for known_root in "${resolved_session_roots[@]}"; do
		[ "$known_root" = "$resolved" ] && {
			duplicate=yes
			break
		}
	done
	[ "$duplicate" = yes ] || resolved_session_roots+=("$resolved")
done

for transcripts in "${resolved_session_roots[@]}"; do
	if [ -d "$transcripts" ]; then
		if ! find -H "$transcripts" -type f -name '*.jsonl' -print0 >> "$session_candidates"; then
			session_discovery_failed=yes
		fi
	elif [ -e "$transcripts" ] || [ -L "$transcripts" ]; then
		# Existing non-directories and dangling links are not an empty store.
		session_discovery_failed=yes
	else
		# Confirm absence through the nearest existing ancestor. A failed stat
		# below an unsearchable ancestor is indistinguishable from absence.
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
done
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

git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r wt; do
	[ "$wt" = "$main_wt" ] && continue

	size_kib=$(du -sk "$wt" 2>/dev/null | awk '{print $1}')
	case "$size_kib" in ''|*[!0-9]*) size_kib=0 ;; esac
	size=$(du -sh "$wt" 2>/dev/null | awk '{print $1}')
	[ -n "$size" ] || size=?
	head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
	head_ts=$(git -C "$wt" log -1 --format='%ct' HEAD 2>/dev/null || echo 0)
	age=$([ "$head_ts" -gt 0 ] 2>/dev/null && echo "$(( (now - head_ts) / 86400 ))d" || echo "?")

	# Squash-merged branches are not ancestors of main, so PR state is the
	# real signal; merge-base only catches fast-forward/rebase merges.
	git merge-base --is-ancestor "$head" origin/main 2>/dev/null && merged=YES || merged=no

	# Include ignored entries: they may be the only copy of user data (for
	# example, a worktree-local .env) and therefore can never be called clean.
	status_failed=no
	if ! porcelain=$(git -C "$wt" status --porcelain --ignored 2>/dev/null); then
		status_failed=yes
		dirty=unknown
	elif [ -z "$porcelain" ]; then
		dirty=clean
	else
		counts=$(printf '%s\n' "$porcelain" | awk '
			/^\?\?/ { untracked++; next }
			/^!!/ { ignored++; next }
			{ tracked++ }
			END { print tracked + 0, untracked + 0, ignored + 0 }
		')
		IFS=' ' read -r tracked_count untracked_count ignored_count <<< "$counts"
		if [ "$tracked_count" -gt 0 ]; then
			dirty="wip:$tracked_count"
			[ "$untracked_count" -gt 0 ] && dirty="$dirty,scratch:$untracked_count"
			[ "$ignored_count" -gt 0 ] && dirty="$dirty,ignored:$ignored_count"
		elif [ "$ignored_count" -gt 0 ]; then
			if [ "$untracked_count" -gt 0 ]; then
				dirty="scratch:$untracked_count,ignored:$ignored_count"
			else
				dirty="ignored:$ignored_count"
			fi
		else
			dirty="scratch:$untracked_count"
		fi
	fi

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

	# Most recent chat whose valid first-line session header names this
	# worktree or a descendant. Resolve both sides without eval so symlinked
	# paths compare by location and a sibling prefix never counts as a child.
	last="-"; last_ts=0; transcript_match=no; timestamp_failed=no
	transcript_scan_failed=$session_discovery_failed
	if ! wt_resolved=$(CDPATH= cd -P -- "$wt" 2>/dev/null && pwd -P); then
		transcript_scan_failed=yes
		wt_resolved=$wt
	fi
	while IFS= read -r -d '' candidate; do
		header=""
		IFS= read -r header < "$candidate"
		header_status=$?
		if [ "$header_status" -ne 0 ] && [ -z "$header" ]; then
			transcript_scan_failed=yes
			continue
		fi

		# Every .jsonl candidate must start with a valid session object whose
		# cwd is a string. Unknown or malformed data cannot prove safety.
		if ! header_cwd=$(printf '%s\n' "$header" | jq -e -r '
			select(.type == "session")
			| if (.cwd | type) == "string"
				then .cwd
				else error("invalid session header")
				end
		' 2>/dev/null); then
			transcript_scan_failed=yes
			continue
		fi
		if ! header_cwd_resolved=$(CDPATH= cd -P -- "$header_cwd" 2>/dev/null && pwd -P); then
			transcript_scan_failed=yes
			continue
		fi
		if [ "$header_cwd_resolved" != "$wt_resolved" ]; then
			wt_prefix=$wt_resolved/
			case "$header_cwd_resolved" in
				"$wt_prefix"*) ;;
				*) continue ;;
			esac
		fi
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

	case "$dirty" in
		wip:*|scratch:*|*ignored:*|unknown) bucket=hold-wip ;;
		*)
			case "$pr" in
				*OPEN*) bucket=hold-open-pr ;;
				*)
					if [ "$recent" != no ]; then bucket=verify-recent-chat
					elif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe
					else bucket=review; fi
					;;
			esac
			;;
	esac

	printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
		"$size_kib" "$size" "$age" "$merged" "$dirty" "$remote" "$pr" "$last" "$bucket" "$wt"
done | LC_ALL=C sort -t$'\t' -k1,1nr | cut -f2-

rm -f "$pr_pages" "$prs" "$session_candidates"
