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

Prefer the current OMP session path, an explicit transcript path, or a supplied `history://` or `agent://` reference. Only when none resolves, run `omp config path`, trim its non-empty output as `agent_dir`, and `glob` `<agent_dir>/sessions` recursively for recent `*.jsonl` candidates. Resolve the profile before searching: if `OMP_PROFILE` is defined, use it even when explicitly empty; only when it is undefined may `PI_PROFILE` supply the value. Trim the selected value. Normalize unset, trimmed-empty, or literal `default` to the default profile; never treat `default` as named or probe `/profiles/default`. A named profile must satisfy OMP's contract: lowercase, 1-64 characters matching `[a-z0-9][a-z0-9._-]{0,63}`, not ending in `.`, and not a reserved device basename (`CON`, `PRN`, `AUX`, `NUL`, `COM0`-`COM9`, or `LPT0`-`LPT9`, including those followed by an extension). Only when `XDG_DATA_HOME` is explicitly set and the applicable omp data root exists, additionally search `$XDG_DATA_HOME/omp/sessions` for the normalized default profile or `$XDG_DATA_HOME/omp/profiles/<profile>/sessions` for a named profile. Do not invent a data-root fallback when `XDG_DATA_HOME` is unset. Named-profile discovery never reads default-profile sessions. Order candidates by modification time and `read` each first JSONL line. Select the newest session header whose `cwd` equals the active workspace. Never cross that boundary without explicit user permission. `read` the full selected transcript. Do not analyze from the conversation context alone.
The additional XDG sessions root is eligible only on `linux` or `darwin`, and only when the active `agent_dir` equals the profile-derived default (`isDefault`). With a custom `PI_CODING_AGENT_DIR`, scan only `<custom-agent_dir>/sessions` and skip XDG even if `$XDG_DATA_HOME/omp` exists. On Windows (`win32`), ignore XDG.

### 2. Spawn three reviewers in parallel

Call native `task` once with a shared `context` and three items with stable names: `judgment`, `tooling`, and `divergent`. Set `agent: "poteto-agent"` on every item. Give each item a complete reason-bearing `task` from its prompt template. Do not add a `model` field. Prompts forbid writes while allowing configured MCP tools for citation checks. The parent applies edits.

| Lens | Prompt template |
|---|---|
| Judgment | `skill://reflect/references/judgment-reviewer.md` |
| Tooling | `skill://reflect/references/tooling-reviewer.md` |
| Divergent | `skill://reflect/references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Native task auto-delivers each reviewer's findings.

### 3. Synthesize

Call native `task` once with a one-item batch named `Synthesize`. Set `agent: "poteto-agent"` and give it a complete reason-bearing `task` based on `skill://reflect/references/synthesizer.md`. Do not add a `model` field. Insert every reviewer's full output where marked. The task forbids writes but allows configured MCP tools for citation spot-checks. The synthesizer returns a structured Accepted, Rejected, and Backlog list.

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
