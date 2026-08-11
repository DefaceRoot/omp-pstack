---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

- The user said "reflect" or "/reflect".
- A complex task (5+ tool calls) just landed cleanly and the recipe is worth keeping.
- The agent hit dead ends, found the working path, and the path generalizes.
- The user corrected the agent's approach mid-task.
- A non-trivial workflow emerged that isn't captured anywhere.

Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

OMP transcripts live recursively under `~/.omp/agent/sessions/` (or `$XDG_DATA_HOME/omp/sessions/` when XDG data directories are enabled). Use the current session path when the host supplies it. Otherwise `glob` only that sessions root for recent `*.jsonl` candidates, order them by modification time, and `read` each first JSONL line. The first entry is a session header; select the newest header whose `cwd` equals the active workspace and whose id/title identifies this conversation. Never mine a different `cwd` without explicit permission. Child OMP transcripts live beside the parent artifact tree and are noise for this step. If no path resolves, write a tight digest of the current conversation and pass that instead.

### 2. Spawn three reviewers in parallel

Call `pstack_task` once with `strategy: "slice"` and three slices named `judgment`, `tooling`, and `divergent`. Give each slice its complete template-based task and optional configured selector in the slice's `model`; defaults are `auto`. The extension runs three OMP `poteto-agent` subprocesses concurrently. Prompts forbid writes while allowing configured MCP tools for citation checks; the parent applies edits.

| Lens | `model` | Prompt template |
|---|---|---|
| Judgment | your configured reflect-judgment model (default `auto`) | `skill://reflect/references/judgment-reviewer.md` |
| Tooling | your configured reflect-tooling model (default `auto`) | `skill://reflect/references/tooling-reviewer.md` |
| Divergent | your configured reflect-judgment model (default `auto`) | `skill://reflect/references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `pstack_task` response body.

### 3. Synthesize

Call `pstack_task` with `strategy: "slice"`, one slice `{ id: "synthesize", task: <complete synthesis brief> }`, and the configured reflect-judgment selector as `model` (default `auto`). Use `skill://reflect/references/synthesizer.md` verbatim with every reviewer's full output inserted where marked. The task forbids writes but allows configured MCP tools for citation spot-checks. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. The synthesizer already applies this criterion; this is a final pass before edits land. See `skill://principle-encode-lessons-in-structure`.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org; do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Those are tracker submissions, not skill edits. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing authored-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): edit its `SKILL.md` directly.
- Substantive existing authored-skill edit (a new section, a new pattern table, more than about 10 lines): follow `skill://poteto-mode/playbooks/authoring-a-skill.md` and run its draft, validate, test, and iterate loop.
- `tune description: <skill path>`: edit that authored `SKILL.md` frontmatter and test discovery against representative prompts.
- New project skill: author `.omp/skills/<kebab-name>/SKILL.md` with `name` and `description` frontmatter and follow the same authoring playbook.
- New personal managed skill: when `manage_skill` is available and the user explicitly wants a managed user skill, call `manage_skill` with `action: "create"`; otherwise author a normal project skill. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
