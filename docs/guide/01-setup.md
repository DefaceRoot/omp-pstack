# Set up P-Stack

Install the plugin, inspect the model roles, then run a real task. Model choices live in OMP's native pickers, not in a project rule.

## Install the plugin

Install the extension from a terminal:

```text
omp install github:DefaceRoot/omp-pstack
```

OMP installs and enables `@defaceroot/omp-pstack`. Confirm it with `omp plugin list --json`, then start a fresh OMP session so its skills, agents, tools, and slash aliases are discovered.

## Pick your models

Open `/model` → Roles. Assign models to any of the three P-Stack roles:

| Role | Agent | Work |
|---|---|---|
| P-Stack Code (`@pstack-code`) | `poteto-agent` | Code delegates, exploration, and ordinary helpers. |
| P-Stack Judgment (`@pstack-judgment`) | `poteto-judgment` | Hard changes, prose, synthesis, and judgment. |
| P-Stack Precise (`@pstack-precise`) | `poteto-precise` | Precisely specified execution and reflect tooling review. |

An unassigned role inherits your session model. In `/agents`, you can override the model on any of those three agents. A panel uses the three role assignments, and a cross-family judge chooses an assigned role from a family different from the session model when one is available.

Run `/setup-pstack` to see the three role assignments and any `/agents` overrides. It explains where to change them. It also offers to delete a legacy `<agent_dir>/rules/pstack-models.md` left by older omp-pstack versions. Accept or decline that cleanup as appropriate. Changing a role or agent override takes effect on the next spawn. You do not need to restart OMP.

Native `task` handles ordinary independent slices. Call it once with shared `context` and named items, each with an `agent` and a complete reason-bearing `task`. No `model` field belongs on native task items. Idle children park automatically. Use `hub` to inspect and revive them. Reserve `pstack_task` for panels, explicit per-arm selection, races, and cross-family judges.

`/pstack-status` reports mode ON/OFF and the role → model summary. `/pstack-cleanup` asks for confirmation before clearing the three `modelRoles.pstack-*` assignments, clearing model overrides for the three Poteto agents in `/agents`, and deleting the legacy rule file if present.

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
