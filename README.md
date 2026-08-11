# omp-pstack

`@defaceroot/omp-pstack` is a native [Oh My Pi](https://github.com/can1357/oh-my-pi) extension package. It ports the full P-Stack skill, playbook, agent, and automation collection to OMP and also ships exactly three selected skills from cursor-team-kit: `deslop`, `control-cli`, and `control-ui`.

The extension runs through OMP's extension, command, skill, agent, and subprocess APIs. It does not install a Cursor compatibility layer and has no package lifecycle script that writes outside the installed package.

## Install

Install directly from GitHub:

```sh
omp install github:DefaceRoot/omp-pstack
```

For a local checkout, run this from the checkout directory:

```sh
omp install .
```

Alternatively, from the checkout's parent directory:

```sh
omp install ./omp-pstack
```

Confirm that OMP sees the package:

```sh
omp plugin list --json
```

The result should include `@defaceroot/omp-pstack` as an enabled plugin. Restart OMP if the current session predates the installation.

## Use

### Configure model routing

Run `/setup-pstack` in OMP. It reads the selectors available from `omp models --json`, lets you choose models for P-Stack roles, and asks before writing the generated routing rule at:

```text
~/.omp/agent/rules/pstack-models.md
```

The rule is optional; omitted roles use OMP's automatic model selection. Re-running `/setup-pstack` validates the current choices and replaces the same generated file rather than appending another configuration.

### Enable the workflow mode

Run `/poteto-mode` to enable the P-Stack workflow guidance for the current session. The mode is sticky within that session. Use `/pstack-status` to see whether it is on, and `/pstack-off` to turn the session mode off.

P-Stack's other shipped skills are available as native OMP slash commands. Their source content lives in package paths such as `skills/poteto-mode/`.

### Try the workflows

Run this representative P-Stack trial in an OMP session rooted at your project:

```text
/setup-pstack
/poteto-mode
/pstack-status
/pstack-off
```

`/setup-pstack` takes your model choices, `/poteto-mode` enables the workflow guidance for the session, `/pstack-status` verifies it, and `/pstack-off` disables it.

The bundled cursor-team-kit skills accept a concrete task after the slash command:

```text
/deslop Review the current branch diff against main and remove AI-generated code slop without changing behavior.
/control-cli Reproduce the startup hang in `bun run tui`, enter `help`, then press Ctrl-C; capture the terminal transcript.
/control-ui Start `bun run dev`, open http://localhost:3000, submit the login form, and capture a screenshot plus an accessibility snapshot.
```

`/deslop` cleans up code style using the current branch diff as input. `/control-cli` drives and inspects an interactive CLI or TUI using the command and terminal actions you provide. `/control-ui` drives a browser or Electron UI using the local start command, URL, interactions, and requested evidence.

### Run parallel model work

The extension registers the native `pstack_task` tool for P-Stack workflows and agents:

- `panel` runs one shared prompt against multiple model selectors.
- `slice` runs distinct, independently described assignments concurrently.

The tool launches OMP subprocess agents in the current working directory. Routed skills such as Poteto mode use the model choices from `~/.omp/agent/rules/pstack-models.md` when present and otherwise defer to OMP's automatic selection.

## Disable or remove

Disabling prevents OMP from loading the plugin but keeps it installed:

```sh
omp plugin disable @defaceroot/omp-pstack
```

Disabling does not delete the generated model-routing rule or files created by P-Stack workflows.

For a clean removal, perform these steps while the plugin is still enabled:

1. In OMP, run `/pstack-cleanup`.
2. Review the confirmation prompt. On confirmation, it deletes only `~/.omp/agent/rules/pstack-models.md`; declining leaves the file unchanged.
3. Uninstall the package:

   ```sh
   omp plugin uninstall @defaceroot/omp-pstack
   ```

For a GitHub remote install, uninstall removes OMP's managed installed copy. For a local-link install from a local checkout, uninstall removes only OMP's plugin registration/link; it never deletes the user-owned checkout or working tree.

Uninstall removes package-owned assets shipped by the plugin, including its installed `src/`, `skills/`, `agents/`, `automations/`, documentation, and license files. It does not remove user-generated project artifacts: project files, worktrees, branches, reports, configuration, and other P-Stack outputs remain yours. `/pstack-cleanup` also does not remove those artifacts or the local checkout; when confirmed, it deletes only `~/.omp/agent/rules/pstack-models.md`, and declining leaves that file unchanged. If the plugin has already been uninstalled, inspect and remove that one generated rule manually if desired.

## Upstream and licensing

This package ports P-Stack version 0.14.0 at commit `6f7e183aa9f48805c38746705fe6a17d42cafb94`:

- [P-Stack upstream](https://github.com/cursor/plugins/tree/main/pstack)
- [cursor-team-kit upstream](https://github.com/cursor/plugins/tree/main/cursor-team-kit)

P-Stack's original MIT notice is in [LICENSE](LICENSE). The separately attributed cursor-team-kit MIT notice for the bundled `deslop`, `control-cli`, and `control-ui` subset is in [LICENSES/CURSOR-TEAM-KIT-MIT.txt](LICENSES/CURSOR-TEAM-KIT-MIT.txt).
