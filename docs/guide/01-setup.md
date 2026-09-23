# Set up P-Stack

Install the plugin, configure its agents, then run a real task. Model choices live in `/agents`, not in a project rule.

## Install the plugin

Install the extension from a terminal:

```text
omp install github:DefaceRoot/omp-pstack
```

OMP installs and enables `@defaceroot/omp-pstack`. Confirm it with `omp plugin list --json`, then start a fresh OMP session so its skills, agents, and slash aliases are discovered.

## Pick your models

Open `/agents` to set each P-Stack agent's model and thinking level. Each slot defaults to the listed OMP built-in role.

| Agent | Job | Default built-in role |
|---|---|---|
| `poteto-agent` | Ordinary helpers and sub-coordinators | `@task` |
| `pstack-feature` | Feature and refactoring delegates | `@task` |
| `pstack-bug-fix` | Bug-fix delegates | `@task` |
| `pstack-perf` | Performance delegates | `@task` |
| `pstack-hillclimb` | Per-hypothesis delegates | `@task` |
| `pstack-judgment` | Prose and judgment | `@slow` |
| `pstack-hardest` | Cross-cutting design and difficult tasks | `@slow` |
| `pstack-how-explorer` | Subsystem exploration | `@task` |
| `pstack-how-explainer` | Subsystem explanation and synthesis | `@slow` |
| `pstack-why-investigator` | Evidence gathering for rationale | `@task` |
| `pstack-why-synthesizer` | Rationale synthesis | `@slow` |
| `pstack-reflect-tooling` | Reflection on tools | `@task` |
| `pstack-reflect-judgment` | Reflection on decisions | `@slow` |
| `pstack-reflect-divergent` | Divergent reflection | `@slow` |
| `pstack-reflect-synthesizer` | Reflection synthesis | `@slow` |
| `pstack-swarm-worker` | Independent coverage slices | `@task` |
| `pstack-arena-runner-1` | Arena candidate 1 | `@default` |
| `pstack-arena-runner-2` | Arena candidate 2 | `@slow` |
| `pstack-arena-runner-3` | Arena candidate 3 | `@task` |
| `pstack-architect-runner-1` | Architect design candidate 1 | `@default` |
| `pstack-architect-runner-2` | Architect design candidate 2 | `@slow` |
| `pstack-architect-runner-3` | Architect design candidate 3 | `@task` |
| `pstack-interrogate-reviewer-a` | Adversarial reviewer A | `@default` |
| `pstack-interrogate-reviewer-b` | Adversarial reviewer B | `@slow` |
| `pstack-interrogate-reviewer-c` | Adversarial reviewer C | `@task` |
| `pstack-cross-judge` | Blind judging and second opinions | `@slow`, `@default`, `@task` pool |

Arena, architect, and interrogate have three slots each. Disable a slot in `/agents` to shrink that panel. Set different model families on its slots for diversity. If you request more members than enabled slots, the skill reuses slots in order. For `pstack-cross-judge`, the extension prefers a pool entry whose family differs from the spawning session's model.

Run `/setup-pstack` to list every P-Stack agent and its effective model. It offers to delete a legacy routing rule left by older installs. Changing an agent override takes effect on the next spawn without restarting OMP.

Native `task` handles panels and independent slices. Call it once per fan-out with shared `context` and named items. Each item has an agent name and a complete reason-bearing `task`. Model choices belong in `/agents`, not in task items. Idle children park automatically. Use `hub` to inspect and revive them.

`/pstack-status` reports mode ON/OFF and effective agent models. `/pstack-cleanup` asks for confirmation before clearing P-Stack agent overrides and disabled entries and deleting the legacy rule file if present.

## Accept the verification offer, or don't

If your project has no `.omp/skills/verify-*` skill, `/setup-pstack` offers to run [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md). Accept and it writes `.omp/skills/verify-<app>/`, a project-local skill that teaches agents to drive the app and prove its behavior. The generator proves the skill works once before handing it over. Decline and setup moves on. You can run `/create-verification-skill` yourself later. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) explains when it's useful.

## Run your first task

Pick something real but small and describe it the way you'd describe it to a colleague:

```text
/poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps, the Feature playbook for this prompt. If `/poteto-mode` skips one, it stays in the list with `skip: <reason>` so you can see why.

`/poteto-mode` stays on for the conversation until you opt out or run `/pstack-off`.

Next: [Route work through `/poteto-mode`](./02-poteto-mode.md).
