### Opening a PR

Invoked at the end of every other playbook.

**Worktree.** Work from a clean git worktree off main. OMP `pstack_task` subprocesses inherit the extension's current `cwd`; they do not create worktrees automatically. For parallel writers, create one exclusive worktree per slice before dispatch and put that exact path in the slice task. A dirty branch with unrelated work stays untouched; use a fresh worktree and apply only the owned patch.

**Commits.** Commit liberally; rebase into small, ordered commits before opening PRs. Each commit is a future PR: landable, ordered to tell the story. Amend when the fix belongs in a just-made commit; new commit when separable.

**PRs.** `/deslop` the diff before commit; `/no-comments` the diff before review; apply `skill://unslop` to the PR description and commit bodies. Small PRs, 5 narrow over 1 fat; stack follow-ups, branch off main only for genuinely independent work. For stacked PRs, use whatever stacking tool your team uses; the principle is small, ordered slices with the stack visible to reviewers. `gh pr view <number>` before referencing PR status. Rebase on `main` before substantial stack work. No `## Summary` / `## Test plan` boilerplate on small PRs; commit bodies don't restate the subject. After opening, run the pstack **Babysit** playbook; push back when feedback drifts from intent.

A subagent that opens a PR runs `interrogate`, `/deslop`, and `/no-comments`, returns the URL, and does NOT babysit. Return to the parent.
