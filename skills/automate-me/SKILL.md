---
name: automate-me
description: "Use for \"automate me\", creating or refreshing a personal mode skill, or capturing the user's working style. Authors an OMP SKILL.md and can mine recent OMP transcripts."
disable-model-invocation: true
---

# Automate me

A guided flow for turning the user's working conventions into a skill agents will follow. The output is one `-mode` skill tailored to them (e.g. `jay-mode`, `priya-mode`).

This skill orchestrates an inline mining pass, OMP `SKILL.md` authoring (or `manage_skill` for an explicitly requested personal managed skill), and `skill://unslop` for prose discipline. It sequences them; it doesn't replace them.

## Flow

### 0. Check for an existing skill

Look one level under `.omp/skills/*-mode/SKILL.md` and `~/.omp/agent/skills/*-mode/SKILL.md` for the user's handle. OMP skill discovery is non-recursive under each skills root, so never hide a generated mode inside a category directory. If one exists, confirm intent with the lowercase `ask` tool unless the user already requested an update:

- Update the existing skill (default for repeat runs)
- Start fresh (rare; ask why before doing it)

Update mode changes the rest of the flow:
- Step 1 mines only history since the skill was last edited (`git log -1 --format=%cI <path>`).
- Step 2 asks what's changed or missing, not what to capture from zero.
- Step 4 edits the existing file in place. Preserve sections the user hasn't contradicted; revise ones with new evidence; add new sections only for genuinely new rules.

### 1. Mine their history

Locate OMP transcripts recursively under `~/.omp/agent/sessions/` (or `$XDG_DATA_HOME/omp/sessions/`). Filter candidates by the first JSONL session header's `cwd`, which must equal the active workspace, and order by modification time. Never read a different workspace's transcript without explicit permission.

Survey recent agent conversations within that scope for recurring patterns. Call `pstack_task` with `strategy: "slice"`, one complete task per non-overlapping time window (for example, three slices across the last 2-4 weeks), and the configured fast selector or `auto`. Each OMP slice reads only the header-filtered transcript paths the parent provides and returns a short structured list of patterns with evidence pointers. Default signals worth hunting:

- Response preferences (length, tone, format, "dumb it down" corrections)
- Delegation habits (subagents, models, specialized workflows, parallelism)
- Verification posture (what "done" means; unit tests vs live repro; reviewers)
- Code and prose discipline (style, principles cited, lint/format tools)
- Process conventions (worktrees, commits, PRs, review/merge tooling)
- Meta preferences (fixing skills mid-task, proposing new ones)

Cross-check across slices before elevating a signal. Patterns seen in 2+ slices are high-confidence; lone signals are weak and usually get dropped.

### 2. Ask the user directly

Mining misses intent that hasn't come up yet. Use the `ask` tool (structured multi-choice) rather than asking the user to type from scratch. Lower cognitive load, higher hit rate.

Shape: one or two questions with 4-6 options each, `allow_multiple: true` for category questions. Start broad ("Which areas matter most?"), then follow up on selected areas with specific options. After the structured rounds, one free-form chat question catches anything the options missed.

Don't dump 20 questions. Two structured rounds plus one open question is usually enough.

### 3. Cluster findings

Group the combined signals into sections. Common ones (use only what applies):

- **Response style**: length, tone, format.
- **Autonomy**: how much to do without asking; MCP tool use.
- **Understand first**: which skills to reach for when scoping or investigating a change.
- **Subagents**: default, parallelism, model-to-task, specialized workflows.
- **Prose / code discipline**: principles, lint tools, style guides.
- **Review and verify**: repro posture, verification skills, live-testing tools.
- **Process**: git worktrees, commits, PRs, review/merge tooling.
- **Skills**: skill-authoring habits, fix-the-skill-first, proposing new skills.

Read `skill://poteto-mode` for granularity. Don't copy its content; the user's rules are not the same as poteto-mode's.

### 4. Draft the skill

Author or update the skill as a normal OMP `SKILL.md`:

- Path: preserve the existing path. For a new project mode, write `.omp/skills/<handle>-mode/SKILL.md`. For a user-authored mode, write `~/.omp/agent/skills/<handle>-mode/SKILL.md`. Both roots are one-level, non-recursive discovery locations.
- Managed alternative: only when the user explicitly wants a personal managed skill and `manage_skill` is available, call `manage_skill` with `action: "create"` or `"update"` instead of writing an authored path.
- Handle: the user's first name or chosen identifier.
- Frontmatter `name`: exactly `<handle>-mode` in lowercase kebab case.
- Frontmatter `description`: trigger on their name, `/<handle>-mode`, and "work in their style", not generic work terms.
- Frontmatter formatting: keep `description` as one valid YAML scalar; quote it or use `description: >-` with indented continuation lines when punctuation or wrapping requires it.
- Frontmatter `disable-model-invocation: true` by default. Opt out only when the user explicitly wants automatic matching.

### 5. Iterate on prose

Apply `skill://unslop` and `skill://poteto-mode/playbooks/authoring-a-skill.md` to every line. Both apply to any agent-read prose, not just skills.

Show the draft to the user and take feedback. Expect multiple iterations. Cut ruthlessly; a mode skill is not a manual.

### 6. Land it

Work in a worktree off main. Commit and open a PR so the user can review it. Don't push to main directly.

## Guardrails

- **Don't overfit to one conversation.** A preference stated once and contradicted another time is noise. Require multiple instances before codifying it.
- **Don't be clever.** Restating other skills' contents, inventing metaphors, or writing "poetic" prose for an agent reader is cost without benefit. Keep it operational.
- **Reference, don't inline.** Other skills the user relies on should appear as path references, not pasted excerpts. Same for any principle docs they maintain elsewhere.
- **Keep sections minimal.** Only add a section if the user has a specific, non-default rule there. "Communicate clearly" is not a section. "Short paragraphs. Tables when comparing options. Bullets only when items are genuinely parallel." is.
- **Name conventions generic.** Use "the user" or "the human" in imperatives, not the author's first name. Others may read or adopt the skill.
- **Don't force symmetry.** If a user has no process rules worth writing down, skip the Process section entirely. Sparse is fine; bloated is not.

## Evaluation

A `-mode` skill is subjective output. A benchmark loop is not useful here. Vibe-check with the user: does it read like them? Did it miss anything? Then ship.

Run a description-optimization loop only if the skill's trigger accuracy turns out to be a problem in practice.

## When not to use

- User wants a task-specific project skill rather than working conventions: author `.omp/skills/<name>/SKILL.md` directly, with no transcript mining.
- User wants to capture one narrow workflow (e.g. "how I write commit messages"): that's a regular skill, not a mode skill.

## Reference files

- `skill://poteto-mode`: example of the output shape.
- `skill://unslop`: prose discipline for every line.
- `skill://poteto-mode/playbooks/authoring-a-skill.md`: OMP `SKILL.md` authoring and validation.
