---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

Fan out N parallel OMP workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers, not the OMP task concurrency limit.
4. Use `pstack-swarm-worker` for coverage. For a race, assign `pstack-arena-runner-1`, `pstack-arena-runner-2`, and `pstack-arena-runner-3` in order. Set each slot's model and thinking level in `/agents`. For a mixed shape, assign each coverage arm to `pstack-swarm-worker` and each race arm to a suitable arena runner slot.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method, including sample count, what one sample is, and order. The worker records both in its result.

## Phase B: Fan out

For coverage, call native `task` once with shared `context` and one named item per distinct slice. Set `agent: "pstack-swarm-worker"` on each item. Give each a complete task and a separate output.

For an identical-brief race, call native `task` once with the same brief in shared `context`. Give each arm a stable, unique name, a complete task, and a separate output. For N up to three, assign one item per enabled arena runner slot in order until N items are assigned. Disabled slots shrink this panel. For N above three, reuse enabled slots in order until N items are assigned. If none is enabled, report that the race cannot run. Do not put `model` on task items.

For a mixed shape, call native `task` once with one named item per arm. Assign coverage arms to `pstack-swarm-worker` and race arms to suitable enabled arena runner slots. For more race arms than enabled slots, reuse slots in order until every race arm is assigned. If no slots are enabled, report that the race cannot run. Give each arm a complete task and a separate output. Skip disabled slots rather than substituting a model.

A worker that needs a non-default pushed branch receives the branch name in its self-contained task and checks it out only in its assigned isolated worktree.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and rerun that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
