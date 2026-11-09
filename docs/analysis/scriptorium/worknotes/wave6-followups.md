# Wave 6 follow-ups (collected during the wave; resolved in the wave-end fix pass)

Source: coder reports under `.claude/reports/scriptorium/` and CI runs on draft PR #13.

| # | From | Item | Why it matters |
|---|---|---|---|
| 1 | SC-60h | The H-14(e) control assertion (a working hook must fire in the control run) was removed after the run, so the hostile case can now pass vacuously. Restore a control that proves the hook ran. | A test that cannot fail is theatre (repo rule). |
| 2 | SC-60e | H-10 has no per-blob size cap: a 200 MiB zero blob is accepted by the gate (case marked `it.fails`). Needs a small fix packet. | Real gap in the bundle gate. |
| 3 | SC-60c | H-04: `export-ignore` and `export-subst` attributes case marked `it.fails` (git archive honouring export attributes). Needs a fix or an accepted-risk entry. | Possible content smuggling through `git archive`. |
| 4 | SC-60c, 60e, 60f, 60g | Several heavy hostile cases timed out locally under load (2001 commits, 10 000 refs, H-16 log, bidi, H-09 isolation, H-10 seam). CI decides which are real; any that time out in CI get explicit timeouts or timingIt. | Avoid a permanently red or flaky wave check. |
| 5 | SC-60i | 11 H-18 cases skipped locally (no `jq`); CI decides. | Verified only in CI. |
| 6 | SC-63a | Key Vault secrets reach `create-github-app-token` through step outputs (masked). Review whether to tighten. | Credential-path hygiene. |
| 7 | SC-63d..f | Re-verify all action pins against the pins table with `gh api` in the wave review (only `setup-node` was re-verified by the fixer). | Supply-chain pins. |
| 8 | SC-64b/c | `upgrade` was added to the verb allow-list in `geldar-play` (card said not to edit it); accepted. Owner decision 7 default applies (print the cosign command, run no cosign). | Recorded deviation. |
| 9 | SC-61e | `coverage.test.ts` is red by design until all marker and script packets have merged; confirm it is green after SC-61f, SC-61g and SC-61h. | Wave join. |
| 10 | Wave 5 | N4 state-dir permissions, N6 `.cmd` shim quoting, N8 seam gating: carried by SC-60o, 60p, 60q, 60s. | Open security items. |
