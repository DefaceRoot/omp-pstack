# benny

Benny is an archive-only copy of an upstream Cursor automation pack for Slack issue reports. One archived flow triaged reports; the other reproduced confirmed bugs and could prepare a small draft fix. The original filenames, intent, and attribution remain in this directory for provenance.

These sources are dormant. OMP has no native scheduler or activation path for them, and their Cursor-specific setup flow is not runnable from OMP. Treat `FOR_AGENTS.md`, the setup material, templates, and operational files as historical reference only.

## OMP dependency record

The pack historically depended on pstack skills. If those shared skills are needed independently in an OMP project, enable the published plugin from the target repository:

```sh
omp plugin enable @defaceroot/omp-pstack --scope project
```

OMP generates `.omp/plugins/installed_plugins.json`. Review and commit that generated file when the project should retain the dependency; never synthesize or hand-edit the registry JSON.

Do not copy, schedule, enable, or translate the archived automation flow as if it were active. Reactivating Benny would require a separately implemented and tested OMP-native scheduler and trigger path.
