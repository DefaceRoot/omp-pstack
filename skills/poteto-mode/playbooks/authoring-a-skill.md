### Authoring or modifying a skill

**You own the skill's voice.** Agent-facing prose has a higher bar than human prose; unhelpful sentences become instructions.

1. Choose the OMP target. Project-authored skills live one level under `.omp/skills/<name>/SKILL.md`; user-authored skills live under `~/.omp/agent/skills/<name>/SKILL.md`. If the user explicitly wants a personal managed skill and `manage_skill` is available, use `manage_skill` instead and omit frontmatter from its body.
2. Author the smallest complete `SKILL.md`. Frontmatter has a lowercase kebab-case `name` matching the directory and a concrete `description`; operational cross-skill reads use `skill://<name>` and bundled assets use `skill://<name>/<relative-path>`.
3. Validate that referenced files exist and `skill://` links resolve. Add behavioral cases when the contract is structural; skip subjective tests.
4. Apply `skill://unslop`, then run `skill://poteto-mode/playbooks/opening-a-pr.md`.

When in doubt, delete; prose earns its keep by changing a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config); hardcoded details go stale (`skill://principle-encode-lessons-in-structure`). Delegate to other skills by path; don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
