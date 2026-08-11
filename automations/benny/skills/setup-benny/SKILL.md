---
name: setup-benny
description: Archived Benny setup reference. Use only to inspect the original Cursor-oriented design and its OMP migration boundary.
disable-model-invocation: true
---

# Benny setup archive

## Status and provenance

This file preserves the setup intent of Benny's upstream Cursor automation pack as archival context. The adjacent `FOR_AGENTS.md`, templates, and triage and reproduction files retain the original design and attribution.

Benny is dormant and archive-only. OMP has no native scheduler or activation path for these automation sources, so this file is not a runnable setup skill and does not create, update, schedule, or enable an automation.

## OMP dependency record

The archived design depended on shared pstack skills. When those skills are independently required by an OMP project, the supported project-scoped registry operation is:

```sh
omp plugin enable @defaceroot/omp-pstack --scope project
```

OMP generates `.omp/plugins/installed_plugins.json`. Review and commit the generated file when the project should retain that dependency. Never synthesize, hand-author, or directly edit the registry schema, and preserve unrelated plugin entries.

The files under `.omp/automations/benny/` are not plugin skill roots and do not become slash skills through this command.

## Archived design contract

The preserved pack described two coordinated Slack-triggered flows:

- Triage read one top-level report and its thread, classified the report, searched the configured tracker, and returned exactly one thread reply with a Benny verdict marker.
- Reproduction waited for a trusted triage marker, exercised the reported symptom through a configured control adapter, captured evidence, and could prepare a bounded draft pull request after verification.

Both flows kept the source channel and root thread coordinates immutable. Delegated workers had no Slack write capability or Slack credentials. Missing coordinates, tracker access, control capability, or a user-facing feature map caused the flow to fail closed.

The historical configuration surface included:

- Source Slack channel and optional operations channel
- Repository URL and default branch
- Triage identity
- Tracker, team, project, labels, and intake state
- Routing map, control adapter, and user-facing feature map
- Status markers, pull request URL format, budgets, and model selectors

User-owned configuration, feature maps, routing maps, and secrets remained outside the archived pack. Secret-free project configuration could be committed under `.omp/benny/`; secrets belonged in an environment or secret manager.

The archived thread-safety acceptance criteria were:

1. Triage retained the root thread coordinate and posted one verdict reply.
2. The verdict carried one configured Benny marker.
3. Reproduction accepted a marker only from the configured triage identity.
4. Reproduction preserved the immutable source coordinates.
5. No source-channel root message was posted.
6. Delegated workers had no Slack write action.
7. Missing coordinates, a deleted parent, or a failed preflight produced no post and no tracker issue.

These points document the former behavior; they do not provide an OMP execution path. Any future reactivation requires a new OMP-native scheduler, triggers, permissions model, setup instructions, and end-to-end verification before these archived sources can be treated as operational.
