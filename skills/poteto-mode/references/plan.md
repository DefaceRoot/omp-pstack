# Plan

Produce a phased implementation plan grounded in the **Principles** section of `skill://poteto-mode`. The plan is the deliverable. Do not implement.

Open a todolist with one item per step below.

## 0. Triage

Skip the plan when the change is one or two files with an obvious approach. Say so and stop.

Plan when the change spans three or more files, introduces architecture, has competing approaches or unclear scope, or the user asked for one.

## 1. Re-read principles

Read the **Principles** section of `skill://poteto-mode` end to end, and the leaf `principle-*` skills it indexes. The principles govern every plan decision; cross-link them.

## 2. Scope and constraints

State your read of scope and constraints in one paragraph. Use `ask` only for genuinely ambiguous intent (`skill://principle-never-block-on-the-human`); give concrete options with each open question.

Resolve what is in scope vs explicitly out, technical or platform constraints, patterns to preserve, and the definition of done.

## 3. Explore in subagents

Delegate codebase exploration (`skill://principle-guard-the-context-window`).

- For one direct delegate, call lowercase `task` with `agent: "poteto-agent"`. For parallel exploration, call `pstack_task` with `strategy: "slice"`; its OMP subprocesses load the same wrapper. Do not dispatch the bundled planning agent because this workflow owns the plan.
- Pass validated `model` selectors from the relevant named role in the active always-applied pstack model rule already present in the OMP system prompt; default to `auto` when that role is absent.

Each explorer returns file pointers, conventions, dependencies, test infrastructure, and entry points. No inlined dumps.

## 4. Write the plan

The user specifies where the plan lives.

Single file `NN-slug.md` for small plans. For three or more phases, a directory with `overview.md` plus phase files:

```
NN-slug/
├── overview.md
├── phase-1-scaffold.md
├── phase-2-...md
└── testing.md
```

### Phase sizing

- One function or type plus tests, or one bug fix. Not "one file".
- Two to three files touched, max.
- Prefer eight to ten small phases over three to four large ones to preserve option value (`skill://principle-foundational-thinking`).
- Split if a phase has more than five test cases or three functions.

### Overview file

- **Context.** Problem and why now.
- **Scope.** Included; explicitly excluded.
- **Constraints.** Technical, platform, dependency, pattern.
- **Alternatives.** Two or three approaches sketched, choice and rationale (`skill://principle-exhaust-the-design-space`). Skip when constraints dictate one.
- **Applicable skills.** Domain skills the implementer should invoke, by name.
- **Phases.** Ordered standard-markdown links to phase files.
- **Verification.** Project-level commands.
- **Implementation guidance.** Per section 6.

### Phase files

- Back-link to overview.
- **Goal.** What the phase accomplishes.
- **Changes.** Files affected and the change at a high level. What and why, not how. No code snippets.
- **Data structures.** Name the key types or schemas. One-line sketch only (`skill://principle-foundational-thinking`).
- **Verification.** Per section 6.

Order phases so infrastructure and shared types land first (`skill://principle-foundational-thinking`). Each phase should be independently shippable.

For changes touching existing code, apply `skill://principle-redesign-from-first-principles`: if we'd built this with the new requirement on day one, what would it look like? Redesign holistically; deliver incrementally.

If a phase creates or edits an authored skill, the phase instructs the implementer to follow `skill://poteto-mode/playbooks/authoring-a-skill.md`. Use `manage_skill` only for an explicitly requested personal managed skill.

## 5. Verification per phase

Each phase needs both:

**Static.** Type check, lint, project tests pass.

**Runtime.** Exercise the feature on the matching surface via the relevant control skill:

- Browser / Electron / Web UIs: `skill://control-ui` from the bundled team-kit subset.
- CLIs and TUIs: `skill://control-cli` from the bundled team-kit subset.
- Native mobile: whatever simulator-driving skill your team has.
- No control skill for the touched surface: flag it in the plan.

For bug fixes, the loop is reproduce on the surface, fix, verify on the same surface. Unit tests show a branch behaves a certain way; they do not prove the bug is gone (`skill://principle-prove-it-works`).

## 6. Implementation guidance

In the overview, name which poteto-mode non-negotiables the implementer must apply, by name:

- `skill://how` over each unfamiliar subsystem before changing it.
- `skill://interrogate` for adversarial review on contested designs before shipping.
- `/deslop` over each diff before commit. `skill://unslop` over any prose surface.
- `skill://show-me-your-work` to keep a decision trail when the plan is large enough to need an auditable record.
- the pstack **Babysit** playbook after opening the PR.

## 7. Hand back

Summarize phases, scope boundaries, applicable skills, and verification. Stop. The user decides when implementation starts.
