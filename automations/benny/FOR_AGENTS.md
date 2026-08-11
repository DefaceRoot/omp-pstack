# Benny automation archive

## Status

Benny is a dormant, archive-only record of an upstream Cursor automation design. OMP has no native scheduler or activation path for this material. Nothing in this directory is an operational automation, agent entrypoint, or setup workflow.

Treat the files as historical reference only. Do not schedule, activate, or translate the archived flows as though OMP can run them. Any future reactivation requires a separately implemented and tested OMP-native scheduler, trigger path, permissions model, and end-to-end verification.

The supported OMP dependency guidance is maintained in [`README.md`](./README.md). The historical setup contract and migration boundary are preserved in [`skills/setup-benny/SKILL.md`](./skills/setup-benny/SKILL.md); neither document makes Benny executable.

## Preserved design intent

The former design described two coordinated Slack issue-report flows:

1. **Triage:** read a new top-level report and its thread, classify and route it, search the configured tracker for duplicates, and return exactly one thread reply with a Benny verdict marker.
2. **Reproduce and fix:** wait for a trusted triage marker, reproduce a confirmed symptom through a configured control adapter, capture evidence, and prepare at most a bounded draft pull request after verification.

Both flows kept the source channel and root thread coordinates immutable. They treated utility bots as evidence rather than ownership, denied delegated workers Slack credentials and write access, and failed closed when required coordinates, tracker access, control capability, or feature-map context was missing.

The archived configuration surface included Slack channels, repository and branch, tracker routing, triage identity, control and feature-map references, status markers, model selectors, and bounded polling and fix budgets. User-owned configuration and secrets remained outside the pack.

These details document the former behavior only. They are not instructions for installing, configuring, or running Benny.
