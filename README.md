# omp-pstack

[Poteto](https://x.com/poteto) built P-Stack from the skills used to ship code at Cursor. After working across large codebases at Meta, Netflix, and Cursor, and on the React core team, the complaint was simple: AI writes too much slop code. Throughput without quality is not the goal. Go deep first, then write less, better code.

P-Stack makes parallel work less reckless. Its playbooks demand evidence from each agent, so independent work can run at once without trusting a green build as proof. Different models bring different strengths, and OMP lets you assign models by role rather than pinning them in skill text. Fork it, improve it, make it yours.

`@defaceroot/omp-pstack` is a native [Oh My Pi](https://github.com/can1357/oh-my-pi) extension package. It ports P-Stack's skills, playbooks, and agents to OMP and bundles three selected cursor-team-kit skills: `deslop`, `control-cli`, and `control-ui`. It uses OMP's extension, command, skill, agent, and subprocess APIs. It does not install a Cursor compatibility layer or run a package lifecycle script that writes outside the installed package.

## Install

Install directly from GitHub:

```sh
omp install github:DefaceRoot/omp-pstack
```

For a local checkout, run this from the checkout directory. OMP links the checkout, so later edits apply to new sessions without reinstalling:

```sh
omp install .
```

Confirm that OMP sees the package:

```sh
omp plugin list --json
```

The result should include `@defaceroot/omp-pstack` as an enabled plugin. Start a fresh OMP session if the current one predates the installation.

Requires OMP >=18.2.11 for the `before_subagent_spawn` hook that selects a judge from its model pool.

## Get started

1. Run `/setup-pstack` to list the effective model for each P-Stack agent. Set each agent's model and thinking level in `/agents`.
2. Use [`/poteto-mode`](./skills/poteto-mode/SKILL.md) for a task that needs rigor.

New here? The [P-Stack guide](./docs/guide/README.md) walks through setup, prompting, verification, and overnight runs. The other skills are situational. `/poteto-mode` calls them as its steps need them.

## Usage

Start a task with [`/poteto-mode`](./skills/poteto-mode/SKILL.md). It matches your goal to a playbook, copies that playbook's steps into the todo list, invokes the other skills as needed, and reports evidence in plain language. The mode stays active across turns until you opt out or run `/pstack-off`.

```text
/poteto-mode this PR has a subtle bug where the scroll drifts every 750ms even when idle. Repro first, then fix and verify.
```

```text
/poteto-mode I'm going to bed. Land the stack even if CI flakes. I want everything merged by morning.
```

<details>
<summary>The twenty-three playbooks</summary>

| playbook | for |
|---|---|
| [investigation](./skills/poteto-mode/playbooks/investigation.md) | a read-only question. how does x work, why was y built this way, are we sure. |
| [bug fix](./skills/poteto-mode/playbooks/bug-fix.md) | reproduce a defect, root-cause it, and fix with runtime evidence. |
| [perf](./skills/poteto-mode/playbooks/perf-issue.md) | trace a measured slowness and improve it against a baseline. |
| [hillclimb](./skills/poteto-mode/playbooks/hillclimb.md) | sustained, scientific improvement of one metric against a target, looping hypotheses with before/after measurement and one commit per accepted win. |
| [runtime forensics](./skills/poteto-mode/playbooks/runtime-forensics.md) | diagnose a live symptom (leak, idle-cpu spin, glitch) from instrumentation. |
| [trace forensics](./skills/poteto-mode/playbooks/trace-forensics.md) | diagnose a captured profiling artifact (cpuprofile, trace, spindump, heap snapshot). |
| [feature](./skills/poteto-mode/playbooks/feature.md) | new or changed behavior, built from a named data shape. |
| [refactoring](./skills/poteto-mode/playbooks/refactoring.md) | a behavior-preserving change to structure or shape. |
| [prototype](./skills/poteto-mode/playbooks/prototype.md) | a throwaway sketch to make a design or behavioral decision cheaply, or to settle an empirical fork by observing it. |
| [visual parity](./skills/poteto-mode/playbooks/visual-parity.md) | pixel-exact ui equivalence between two implementations. |
| [authoring a skill](./skills/poteto-mode/playbooks/authoring-a-skill.md) | writing or editing a SKILL.md. |
| [eval](./skills/poteto-mode/playbooks/eval.md) | test how a skill or prompt change affects agent behavior, blinded. |
| [babysit](./skills/poteto-mode/playbooks/babysit.md) | drive a pr or a stack to merge-ready: conflicts, review threads, ci. |
| [shipping](./skills/poteto-mode/playbooks/shipping.md) | independently verify a green stack, then land the contiguous verified run bottom-up through github by default or origin when available. |
| [autonomous run](./skills/poteto-mode/playbooks/autonomous-run.md) | drive a long task to completion without stopping. |
| [orchestrate](./skills/poteto-mode/playbooks/orchestrate.md) | a standing project handed to one coordinator chat: multi-day, many stacked prs, fleets of subagents. |
| [autopilot-full](./skills/poteto-mode/playbooks/autopilot-full.md) | run independent prs to merged with one owner per pr and a root swarm verdict on each round, from the code-ready head on. |
| [autopilot-stack](./skills/poteto-mode/playbooks/autopilot-stack.md) | build and verify one linear base-branch stack for the operator to review and land. |
| [session pickup](./skills/poteto-mode/playbooks/session-pickup.md) | resume or take over a prior agent's in-flight work. |
| [pause safely](./skills/poteto-mode/playbooks/pause-safely.md) | suspend in-flight work cleanly so it can be resumed later. |
| [multi-phase plan](./skills/poteto-mode/playbooks/multi-phase-plan.md) | work that spans phases or stacked PRs. |
| [worktree cleanup](./skills/poteto-mode/playbooks/worktree-cleanup.md) | reclaim disk by pruning merged or abandoned worktrees and stale ios simulators, safety-gated. |
| [opening a pr](./skills/poteto-mode/playbooks/opening-a-pr.md) | open a ready pr from small ordered commits with a conventional commits title and a briefing-style body. invoked at the end of every other playbook. |

</details>

[`/poteto-mode`](./skills/poteto-mode/SKILL.md) reads the relevant playbook and the inline principles index at task start. The complete routing rules live in [`skill://poteto-mode`](./skills/poteto-mode/SKILL.md). OMP's `/goal set` can wake a long-running session to check its finish condition.

### Skills

`/poteto-mode` runs most of these as needed. Call one directly when you want a particular kind of help:

```text
/how do we cancel runs? Is there an N+1 when we look up every run to cancel?
/interrogate review this PR.
```

<details>
<summary>All skills</summary>

| skill | use it when |
|---|---|
| [`/poteto-mode`](./skills/poteto-mode/SKILL.md) | default entry point for any non-trivial task. |
| [`/how`](./skills/how/SKILL.md) | you want a walkthrough of how a subsystem works. |
| [`/why`](./skills/why/SKILL.md) | you want to know why something was built this way. discovers available MCPs at run time and queries each evidence category in parallel (source control, issue tracker, long-form docs, real-time chat, infra observability, error tracking, analytics warehouse). |
| [`/recall`](./skills/recall/SKILL.md) | you're starting or resuming work and want your recent context on a topic rebuilt from your own chat history and the shared record, handed back as a tight current-state brief. |
| [`/blast-radius`](./skills/blast-radius/SKILL.md) | you have a small-looking change and want to know what else it could break, with the one fact it's safe because of proven by running code, not asserted. |
| [`/architect`](./skills/architect/SKILL.md) | you're about to write code that crosses a function boundary and want the caller's usage, types, and module shape settled first. |
| [`/arena`](./skills/arena/SKILL.md) | you want N parallel attempts at the same thing, then to grab the best parts of each. |
| [`/swarm`](./skills/swarm/SKILL.md) | you want N parallel workers across different slices or races, then one aggregated report. |
| [`/interrogate`](./skills/interrogate/SKILL.md) | you have a diff and want several different models to try to break it, including a strict code-quality lens. |
| [`/automate-me`](./skills/automate-me/SKILL.md) | you want your own `-mode` skill, drafted from how you've actually worked. |
| `/setup-pstack` | list P-Stack agents, their effective models, and available setup cleanup. |
| [`/reflect`](./skills/reflect/SKILL.md) | a long task landed and you want the recipe captured as a skill edit. |
| [`/teach`](./skills/teach/SKILL.md) | you want to actually understand a change or subsystem, not just have it summarized. runs how + why and weaves one plain explanation, built up diagram by diagram. |
| [`/tdd`](./skills/tdd/SKILL.md) | you're fixing a bug and there's a cheap local test path. write the failing test first, then the fix. |
| [`/no-comments`](./skills/no-comments/SKILL.md) | strip comments before review; spawns Comment Sicko, fixes accepted findings, offers encodings for claimed constraints. |
| [`/typescript-best-practices`](./skills/typescript-best-practices/SKILL.md) | you're reading or editing typescript. grounds the type-system-discipline principle in syntax. |
| [`/figure-it-out`](./skills/figure-it-out/SKILL.md) | no bundled playbook fits. designs a rigorous, auditable playbook for the task. |
| [`/show-me-your-work`](./skills/show-me-your-work/SKILL.md) | you want a reviewable decision trail. logs decisions to a tsv you can commit. |
| [`/create-verification-skill`](./skills/create-verification-skill/SKILL.md) | your project has no scripted way to prove app behavior. generates a project-local verify skill with a feature map, for any language or platform. |
| [`/maintain-verification-skill`](./skills/maintain-verification-skill/SKILL.md) | your verify skill's feature map has drifted from the app. source wave + one live pass, at most one PR of proven corrections. |
| [`/unslop`](./skills/unslop/SKILL.md) | you're cleaning up writing. removes AI tells. |
| [`/bro`](./skills/bro/SKILL.md) | you want the last message restated in plain human language, no jargon. |
| [`/technical-writing`](./skills/technical-writing/SKILL.md) | layered doc standard (Diátaxis + Google developer style + STE + Global English) for docs, RFCs, readmes, PR descriptions, commit messages. |

</details>

### Agents and principles

The shipped `poteto-agent` reads [`skill://poteto-mode`](./skills/poteto-mode/SKILL.md) before work. Use `agent: "poteto-agent"` in native `task` items instead of a generic agent when that workflow matters. Specialized agents cover P-Stack's other model slots. [Comment Sicko](./agents/comment-sicko.md) reviews comments, usually through [`/no-comments`](./skills/no-comments/SKILL.md).

Twenty-three short principle skills back the index in `/poteto-mode`. Other skills can reference each rule by name:

<details>
<summary>All twenty-three principles</summary>

| principle | group | rule |
|---|---|---|
| [laziness-protocol](./skills/principle-laziness-protocol/SKILL.md) | core | Bias toward deletion and the smallest change that solves the problem. |
| [foundational-thinking](./skills/principle-foundational-thinking/SKILL.md) | core | Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious. |
| [redesign-from-first-principles](./skills/principle-redesign-from-first-principles/SKILL.md) | core | Redesign as if the requirement had been a foundational assumption from day one, instead of bolting it on. |
| [attack-the-premise](./skills/principle-attack-the-premise/SKILL.md) | core | Apply when two or more fixes that share one premise have failed the same gate. Take a census of which actors hold the imbalance before the next fix, then question the premise instead of writing another fix that assumes it. |
| [subtract-before-you-add](./skills/principle-subtract-before-you-add/SKILL.md) | core | Remove dead weight, redundant validators, and stub references first, then build on the simpler base. |
| [minimize-reader-load](./skills/principle-minimize-reader-load/SKILL.md) | core | Count layers between question and answer, and hidden state in the reader's head; collapse one-caller wrappers and shrink mutable scope. |
| [outcome-oriented-execution](./skills/principle-outcome-oriented-execution/SKILL.md) | core | Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't preserve smooth intermediate states with throwaway compatibility code. |
| [experience-first](./skills/principle-experience-first/SKILL.md) | core | Choose user delight over implementation convenience; ship fewer polished features over more rough ones. |
| [exhaust-the-design-space](./skills/principle-exhaust-the-design-space/SKILL.md) | core | Build 2-3 competing prototypes and compare side by side before committing. |
| [build-the-lever](./skills/principle-build-the-lever/SKILL.md) | core | Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. The tool is the artifact a reviewer can rerun. |
| [model-the-domain](./skills/principle-model-the-domain/SKILL.md) | architecture | Encode the domain in a structure instead of scattered conditionals. |
| [boundary-discipline](./skills/principle-boundary-discipline/SKILL.md) | architecture | Concentrate guards at system boundaries (CLI, config, network, external APIs); trust internal types and keep business logic in pure functions. |
| [type-system-discipline](./skills/principle-type-system-discipline/SKILL.md) | architecture | Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, refuse to lie to the compiler, exhaust variants, derive from authoritative schemas. |
| [make-operations-idempotent](./skills/principle-make-operations-idempotent/SKILL.md) | architecture | Converge to the same end state regardless of partial prior runs. |
| [migrate-callers-then-delete-legacy-apis](./skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) | architecture | Migrate callers and delete the old API in the same wave instead of preserving compatibility layers. |
| [separate-before-serializing-shared-state](./skills/principle-separate-before-serializing-shared-state/SKILL.md) | architecture | Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant. |
| [prove-it-works](./skills/principle-prove-it-works/SKILL.md) | verification | Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'. |
| [fix-root-causes](./skills/principle-fix-root-causes/SKILL.md) | verification | Trace each symptom to its root cause and fix it there; reproduce first, ask why until you reach it, resist nil-check guards that silence crashes. |
| [sequence-verifiable-units](./skills/principle-sequence-verifiable-units/SKILL.md) | verification | Apply to multi-step work (sweeps, migrations, runs of similar edits) and to how you stack commits and PRs. Break work into small units that each end in a verifiable state, check each before the next, and order delivery so the sequence proves itself to a reviewer. |
| [test-behavior-not-implementation](./skills/principle-test-behavior-not-implementation/SKILL.md) | verification | Apply when you write, change, or keep a test. Call the code the way its users do and assert the result they observe against a literal expected value. If the test would still pass when every imported function returns undefined, rewrite the assertion or delete the test. |
| [guard-the-context-window](./skills/principle-guard-the-context-window/SKILL.md) | delegation | Route bulk to subagents; keep summaries in the main thread, not raw payloads. |
| [never-block-on-the-human](./skills/principle-never-block-on-the-human/SKILL.md) | delegation | Proceed, present the result, let the human course-correct after the fact; reserve confirmation for irreversible actions. |
| [encode-lessons-in-structure](./skills/principle-encode-lessons-in-structure/SKILL.md) | meta | Encode the rule as a lint, metadata flag, runtime check, or script instead of more text. |

</details>

### Make it yours

[`/automate-me`](./skills/automate-me/SKILL.md) reads your recent work, asks which habits belong in a personal mode, and drafts a skill alongside `/poteto-mode`. See [Make it yours](./docs/guide/09-make-it-yours.md) for the workflow. Set each P-Stack agent's model and thinking level in `/agents`.

## Use in OMP

### Configure agent models

Open `/agents` to set each P-Stack agent's model and thinking level. Defaults follow OMP's built-in roles. An unchanged slot uses its listed default.

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

The arena, architect, and interrogate panels have three slots each. Disable a slot in `/agents` to shrink its panel. Set slots to models from different families for diverse attempts. For more members than enabled slots, the skill reuses slots in order. `pstack-cross-judge` uses an ordered model pool. The extension prefers an entry from a different family than the spawning session's model.

`/setup-pstack` lists every P-Stack agent with its effective model and offers to remove a legacy rule file from older installs. It also offers `/create-verification-skill` if the project has no `.omp/skills/verify-*` skill. `/pstack-status` reports whether the session mode is ON or OFF and points to `/setup-pstack` for agent models.

Use native `task` for panels and independent slices. Call it once per fan-out with shared `context` and named items. Each item names a roster agent and has a complete `task`. Model choices come from `/agents`, not the task item. Idle children park automatically. Use `hub` to inspect and revive them.

### Enable the workflow mode

Run `/poteto-mode` to enable P-Stack workflow guidance for this session. Use `/pstack-status` to inspect the mode. Use `/setup-pstack` to inspect agent models. `/pstack-off` turns the mode off. Ctrl+Alt+O places the visible `/poteto-mode ` prefix in the editor so you can type a goal and submit. While active, the status bar shows the Poteto indicator, or `[P] poteto` with the ASCII symbol preset.

Ctrl+Alt+P remains Plannotator's plan-mode shortcut. Ctrl+Shift+P is OMP's built-in reverse model cycle and cannot be overridden by this plugin. OMP's public extension API does not expose native editor or status-frame colors, so the extension cannot add a yellow native border.

Try the commands in an OMP session rooted at your project:

```text
/setup-pstack
/poteto-mode
/pstack-status
/pstack-off
```

The bundled team-kit subset accepts concrete tasks after its slash commands:

```text
/deslop Review the current branch diff against main and remove AI-generated code slop without changing behavior.
/control-cli Reproduce the startup hang in `bun run tui`, enter `help`, then press Ctrl-C; capture the terminal transcript.
/control-ui Start `bun run dev`, open http://localhost:3000, submit the login form, and capture a screenshot plus an accessibility snapshot.
```

`/deslop` cleans the branch diff. `/control-cli` drives an interactive CLI or TUI; `/control-ui` drives a browser or Electron UI. Give each the command, actions, and evidence you need.

## Disable or remove

Disabling prevents OMP from loading the plugin but keeps it installed:

```sh
omp plugin disable @defaceroot/omp-pstack
```

Disabling does not clear P-Stack agent model overrides, disabled slots, or files created by P-Stack workflows. For a clean removal, run `/pstack-cleanup` while the plugin is enabled. It asks for confirmation before clearing P-Stack agent overrides and disabled entries and deleting the legacy routing rule if present. Declining leaves them unchanged. Then uninstall:

```sh
omp plugin uninstall @defaceroot/omp-pstack
```

A GitHub remote install removes OMP's managed copy. For a local-link install, uninstall removes plugin registration but may leave the OMP `node_modules` symlink. It preserves your checkout or working tree. After uninstall, run `omp plugin doctor` to locate `plugins_directory`. If the stale symlink remains, remove only `<plugins_directory>/node_modules/@defaceroot/omp-pstack`:

```sh
omp plugin doctor
rm -- "<plugins_directory>/node_modules/@defaceroot/omp-pstack"
```

Uninstall removes package-owned assets, including installed `src/`, `skills/`, `agents/`, documentation, and licenses. Your project files, worktrees, branches, reports, configuration, and other P-Stack outputs remain yours. `/pstack-cleanup` does not remove those artifacts or your local checkout.

## Upstream and licensing

This package ports P-Stack 0.15.3 at commit [`b42effe0aa50f59c693d7e2924714e015e00bf7c`](https://github.com/cursor/plugins/commit/b42effe0aa50f59c693d7e2924714e015e00bf7c):

- [P-Stack upstream](https://github.com/cursor/plugins/tree/main/pstack)
- [cursor-team-kit upstream](https://github.com/cursor/plugins/tree/main/cursor-team-kit)

The `make-bot-ui` skill and plugin logo depend on Cursor-only products and were not ported. P-Stack's original MIT notice is in [LICENSE](LICENSE). The separately attributed cursor-team-kit MIT notice for bundled `deslop`, `control-cli`, and `control-ui` is in [LICENSES/CURSOR-TEAM-KIT-MIT.txt](LICENSES/CURSOR-TEAM-KIT-MIT.txt).
