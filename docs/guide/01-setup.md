# Set up pstack

In this page you install the plugin, pick which models pstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the plugin

Install the extension from a terminal:

```text
omp install github:DefaceRoot/omp-pstack
```

OMP installs and enables `@defaceroot/omp-pstack`. Confirm it with `omp plugin list --json`, then start a fresh OMP session so the extension's skills, agents, tools, and slash aliases are discovered.

## Pick your models

Run:

```text
/setup-pstack
```

[`/setup-pstack`](../../skills/setup-pstack/SKILL.md) resolves the active profile's `agent_dir`, reads the selectors from `omp models --json`, and writes your choices to `<agent_dir>/rules/pstack-models.md`. The active always-applied pstack model rule is loaded into a new session's system prompt.

Use native `task` first. For ordinary independent slices that use the same model resolution, call `task` once with a shared `context` and a batch of items. Give every item a stable `name`, `agent: "poteto-agent"`, and a complete reason-bearing `task`. Do not put `model` on native task items. Idle native children park automatically. Use `hub` to inspect and wake or revive them. Native task also owns job visibility, persisted child sessions, and auto-delivery.

Reserve `pstack_task` for true model panels, explicit per-call or per-arm model selection, model races, and cross-family judges. Routed skills pass selected model overrides to `pstack_task`; a missing role uses `auto`. Both `inherit-parent` and `auto` tell `pstack_task` to omit its model override. For a panel role, list length sets the panel size. To restore defaults, rerun `/setup-pstack` or use `/pstack-cleanup` to remove `<agent_dir>/rules/pstack-models.md`.

## Accept the verification offer, or don't

At the end of setup, `/setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.omp/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers when it earns its place.

After `/setup-pstack` writes or updates `<agent_dir>/rules/pstack-models.md`, you must start a new OMP session before relying on the changed P-Stack model routing. `/reload-plugins` does not refresh active rules in OMP 17.2.13 and is insufficient; the already-running session does not read the changed rule.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. The first item is always "read the Principles section". The rest are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. `/poteto-mode` is sticky. It stays on for the conversation until you opt out by saying so.

Next: [Route work through `/poteto-mode`](./02-poteto-mode.md).
