### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. Run `skill://how` over the affected subsystem.
2. Run `skill://architect` for parallel design exploration.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (`skill://principle-separate-before-serializing-shared-state`). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing through native `task` with `agent: "pstack-feature"` and a specific scope. Name file paths, success criteria, and the data shape before logic is written. Use `skill://principle-model-the-domain` to choose a state machine over scattered booleans, a table or registry over branching, or a typed model over repeated shape assumptions. Review the diff yourself. When implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via `skill://arena` instead so runners surface the alternatives and the cross-judge guards the pick. Delegation is mandatory. Laziness Protocol does not override it because review separation matters. You can spawn a subagent even though you are one. A subagent forbidden to spawn owns the diff directly. Do not reply "standing by" while waiting on a nested agent. Comments per **Comments**. Re-ground surgical edits against upstream-derived source. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Rebase into small, ordered commits. Stack follow-ups.
   Use `skill://principle-sequence-verifiable-units`, building, verifying, and committing each small unit before the next.
7. If the design is contested, run `skill://interrogate` before shipping.
8. Run `skill://poteto-mode/playbooks/opening-a-pr.md`.

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
