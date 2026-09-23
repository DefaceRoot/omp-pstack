---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Fan out N parallel attempts at the same task. Read every candidate end to end. Pick the strongest as the base. Graft the best ideas from the others into it. Verify the synthesized result.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Cross-judge
4. Pick
5. Graft
6. Verify

## Phase A: Frame

The N candidates will receive the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric. State what success looks like for *this* task, then turn it into 3-6 concrete gradeable criteria. The rubric is the picker's tool in Phase D. Candidates only see the task.
3. By default, pick one candidate per enabled `pstack-arena-runner-1`, `pstack-arena-runner-2`, and `pstack-arena-runner-3` slot. A slot disabled in `/agents` drops out, so the panel shrinks. For a requested N, use N items, taking enabled slots in order and wrapping if needed. If no slots are enabled, ask the user to enable one. Give slots different model families in `/agents` for diversity. For generation-bound work that needs the same model N times, set the slots to the same model.
4. Assign each candidate its own isolated git worktree and output path. If git worktrees are unavailable, use separate `/tmp/arena-<slug>/candidate-<n>/` directories. Follow `skill://principle-separate-before-serializing-shared-state`.

## Phase B: Fan out

Call native `task` once with the same candidate brief and grounding path in shared `context`. Add one named item per selected runner slot. Each item sets `agent` to its `pstack-arena-runner-1`, `pstack-arena-runner-2`, or `pstack-arena-runner-3` slot and gives a complete `task` naming its own isolated worktree, output path, artifact, and short rationale. Reused slots get separate items and worktrees. Do not put a model on an item. Each rationale names the alternatives the candidate considered and what it rejected.

If a candidate fails to produce output, proceed with N-1 and note the dropout in the synthesis record.

## Phase C: Cross-judge

After all Phase B candidates complete, call native `task` once with one item using `agent: "pstack-cross-judge"`. Give the judge the rubric and candidates under neutral path labels, without runner identities or model names. Require a read-only review that scores every criterion and recommends a base with rationale. The extension prefers a model from the judge's pool whose family differs from the session model. Launch the judge while the parent reads in Phase D, never while candidates are still writing. Partial candidate output is not a dropout.

## Phase D: Pick a base

Read every candidate end to end before picking.

Score each candidate against the rubric criterion by criterion, not on holistic feel. Compare against the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base on which candidate a future maintainer can extend most easily without breaking invariants. Prefer the cleaner boundary or smaller API when two feel tied, per the Laziness Protocol.

Record the pick and the reason in a short synthesis note alongside the base artifact, including the cross-judge's verdict.

## Phase E: Graft

Walk each losing candidate once more and identify what is worth porting into the base. The signal is usually one or two things per candidate, not most of it.

Fold each graft in by hand, per `skill://principle-redesign-from-first-principles`. Don't paste mechanically. The result has to remain coherent under one mental model.

Record what was grafted, from which candidate, and what was rejected and why.

When N candidates converge on the same shape, that is a strong agreement signal. Note the convergence in the record and ship the consensus shape. No graft is needed. When N candidates wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

The synthesized artifact has to hold up under the same scrutiny as any other output, per `skill://principle-prove-it-works`.

If verification surfaces a problem the arena did not catch, either Phase A was wrong (re-frame and re-run) or one candidate caught it and you missed the graft (go back to Phase E). Don't paper over.

## Outputs

One synthesized artifact. One short synthesis note alongside, naming the base, the grafts (with source candidate), the rejections, the dropouts if any, and the verification result.
