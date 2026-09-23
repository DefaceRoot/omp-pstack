### Authoring or modifying a skill

**You own the skill's voice.**

1. Choose the OMP target. Project-authored skills live one level under `.omp/skills/<name>/SKILL.md`. For user-authored skills, run `omp config path`, trim its non-empty output, and use `<agent_dir>/skills/<name>/SKILL.md`. If the user explicitly wants a personal managed skill and `manage_skill` is available, use it instead and omit frontmatter from its body.
2. Author the smallest complete `SKILL.md`. Frontmatter has a lowercase kebab-case `name` matching the directory and a concrete `description`. Operational cross-skill reads use `skill://<name>` and bundled assets use `skill://<name>/<relative-path>`.
3. Validate that referenced files exist and `skill://` links resolve. Add behavioral cases when the contract is structural. Skip subjective tests.
4. Apply `skill://unslop`, then run `skill://poteto-mode/playbooks/opening-a-pr.md`.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per `skill://principle-encode-lessons-in-structure`. Delegate to other skills by path. Don't restate. Propose a new skill for a recurring workflow that is not captured.

**Reply:** summary of the skill, key design decisions, validation notes.
