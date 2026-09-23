### Eval

**You own the experiment design. Plan, blind, run, synthesize.**

**Non-negotiables for blinding:**

- No `eval`, `test`, `judge`, `experiment`, `rubric`, `score`, `compare`, `benchmark`, `candidate`, or `arena` in any directory, file, or prompt the candidate sees.
- The candidate prompt looks like an organic user request. State the goal, not the meta.
- No chain-eliciting cues. Don't ask the candidate to list which skills, principles, or files they applied. Ask for design notes generally and grade chain-following from code shape, not self-report.
- Sanitize directory and slug names. Use project-shaped names a user might pick.
- Don't tell the candidate other candidates exist.
- The judge can know it's judging but sees outputs by sanitized label only, never by model name.
- Comparing two variants: one judge scores both sets in a single pass on one scale, blind to which set each came from.

**Steps:**

1. **Frame.** State what variant is under test and what behavior counts as success. Write the rubric (3-6 concrete criteria) for the judge only. Hold it back from candidates.
2. **Set up sanitized environments.** Per-candidate working dir with the variant in place. Plant any context an organic task would have: a project skeleton, the skills the candidate would naturally read.
3. **Author one organic prompt.** What a user would type. No leakage of what's being measured.
4. **Spawn N parallel candidates** per `skill://arena`'s Phase B. Call native `task` once with the same organic prompt in shared `context` and one named item per run. Assign `pstack-arena-runner-1`, `pstack-arena-runner-2`, and `pstack-arena-runner-3` in order with stable item names such as `run-1`, `run-2`, and `run-3`. Each item's `task` names its own sanitized working dir and unique output dir. Skip slots disabled in `/agents`, so the panel shrinks. For N above three, cycle through the slots in order and omit disabled slots on each pass. Keep each active item's name and output dir unique. Set `agent` to the assigned slot and do not set `model`.
5. **Spawn one blinded judge** per `skill://arena`'s Phase C. Call native `task` with one named item and `agent: "pstack-cross-judge"`. It selects a different model family from the spawning session when possible. The judge sees outputs by sanitized label and the rubric, never a model name.
6. **Verify the chain from transcripts, not self-report.** Prefer each OMP assignment's `history://` reference, explicit transcript path, or `agent://` handoff. Only when none resolves, run `omp config path`, trim its non-empty output as `agent_dir`, and locate JSONL recursively under `<agent_dir>/sessions` by exact header `cwd` and child id. Resolve the profile before searching: if `OMP_PROFILE` is defined, use it even when explicitly empty. Only when it is undefined may `PI_PROFILE` supply the value. Trim the selected value. Normalize unset, trimmed-empty, or literal `default` to the default profile. Never treat `default` as named or probe `/profiles/default`. A named profile must satisfy OMP's contract: lowercase, 1-64 characters matching `[a-z0-9][a-z0-9._-]{0,63}`, not ending in `.`, and not a reserved device basename (`CON`, `PRN`, `AUX`, `NUL`, `COM0`-`COM9`, or `LPT0`-`LPT9`, including those followed by an extension). Only when `XDG_DATA_HOME` is explicitly set and the applicable omp data root exists, additionally search `$XDG_DATA_HOME/omp/sessions` for the normalized default profile or `$XDG_DATA_HOME/omp/profiles/<profile>/sessions` for a named profile. Do not invent a data-root fallback when `XDG_DATA_HOME` is unset. Named-profile discovery never reads default-profile sessions. Look at which files each candidate actually opened. Grade chain-following from the files it really read plus the shape of the code, never from the candidate's own claims. Never cross the active workspace boundary without explicit permission.
   The additional XDG sessions root is eligible only on `linux` or `darwin`, and only when the active `agent_dir` equals the profile-derived default (`isDefault`). With a custom `PI_CODING_AGENT_DIR`, scan only `<custom-agent_dir>/sessions` and skip XDG even if `$XDG_DATA_HOME/omp` exists. On Windows (`win32`), ignore XDG.
7. **Read every candidate output yourself** end to end. Compare to the judge's verdict. Disagreement means a model is biased or the rubric is ambiguous. Synthesize.

**Reply:** variant under test, rubric, per-candidate notes, judge's verdict, your synthesis, and a recommendation for whether to promote the variant.
