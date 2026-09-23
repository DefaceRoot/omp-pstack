---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions. Explain architecture well enough for a senior engineer to start working on the subsystem, without annotating every line of code.

## Step 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): one explainer explores and explains in a single pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): spawn parallel explorers, then hand their findings to the explainer. Go to Step 2a.

When in doubt, take the simple path.

## Step 2a. Explore (complex questions only)

Split the question into 2 to 4 distinct exploration angles. Call native `task` once with a shared `context` containing the question, workspace, and read-only instructions. Give each angle a stable item `name`, `agent: "pstack-how-explorer"`, and a complete reason-bearing `task` based on `skill://how/references/explorer-prompt.md`. Name the assigned angle and why it matters. Do not add a `model` field. The explorers must not write files.

Each explorer traces its own slice from entry point to effect, reads the implementation with `glob`, `grep`, and `read`, and returns components, flow, boundaries, files read, non-obvious behavior, and gaps. Overlap is fine. The explainer reconciles it. Go to Step 3.

## Step 2b. Direct explain (simple questions)

Call native `task` once with an item named `Explain`, `agent: "pstack-how-explainer"`, and a complete reason-bearing `task` based on `skill://how/references/explainer-prompt.md`. Omit the explorer-findings section. Instruct the explainer to explore with `glob`, `grep`, and `read` before writing. The task forbids writes and has no `model` field. Go to Step 4.

## Step 3. Synthesize (complex questions only)

Once all explorers return, call native `task` once with an item named `Synthesize`, `agent: "pstack-how-explainer"`, and a complete reason-bearing `task` based on `skill://how/references/explainer-prompt.md`. Include every explorer's findings. The explainer resolves overlap and contradictions by checking the code and writes one explanation. The task forbids writes and has no `model` field.

## Step 4. Present

Present the explainer's output to the user. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output format

Use the sections in `skill://how/references/explainer-prompt.md`, dropping those that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
