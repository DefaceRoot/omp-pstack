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
4. Use native `task` with `agent: "poteto-agent"` for coverage workers. For races and mixed shapes that need per-arm model selection, name each arm's `pstack_task` role alias or exact `provider/model` selector up front.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method, including sample count, what one sample is, and order. The worker records both in its result.

## Phase B: Fan out

For coverage, call native `task` once with shared `context` and one item per distinct slice. Give every item a stable `name`, `agent: "poteto-agent"`, and a complete reason-bearing `task`. Do not put `model` on native task items. For an identical-brief race, call `pstack_task` with `strategy: "panel"`, put the brief in `prompt`, and pass one named role alias or exact `provider/model` selector per arm in `models`. For a mixed shape with explicit per-arm model selection, encode each arm as a complete `pstack_task` slice with its own named selector.

A worker that needs a non-default pushed branch receives the branch name in its self-contained task and checks it out only in its assigned isolated worktree.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and rerun that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
