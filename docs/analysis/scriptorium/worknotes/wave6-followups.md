# Wave 6 follow-ups (collected during the wave; resolved in the wave-end fix pass)

Source: coder reports under `.claude/reports/scriptorium/` and CI runs on draft PR #13.

| # | From | Item | Why it matters | Status (2026-11-10) |
|---|---|---|---|---|
| 1 | SC-60h | The H-14(e) control assertion (a working hook must fire in the control run) was removed after the run, so the hostile case can now pass vacuously. Restore a control that proves the hook ran. | A test that cannot fail is theatre (repo rule). | Resolved in 479246d (H-14e control, S2) |
| 2 | SC-60e | H-10 has no per-blob size cap: a 200 MiB zero blob is accepted by the gate (case marked `it.fails`). Needs a small fix packet. | Real gap in the bundle gate. | Resolved in d2e898c (per-blob cap of 2 MiB, `MAX_BLOB_BYTES`) |
| 3 | SC-60c | H-04: `export-ignore` and `export-subst` attributes case marked `it.fails` (git archive honouring export attributes). Needs a fix or an accepted-risk entry. | Possible content smuggling through `git archive`. | Resolved in 479246d (S4/S5: `export-ignore` and `export-subst` refused) |
| 4 | SC-60c, 60e, 60f, 60g | Several heavy hostile cases timed out locally under load (2001 commits, 10 000 refs, H-16 log, bidi, H-09 isolation, H-10 seam). CI decides which are real; any that time out in CI get explicit timeouts or timingIt. | Avoid a permanently red or flaky wave check. | Open (carried to the wave 7 review) |
| 5 | SC-60i | 11 H-18 cases skipped locally (no `jq`); CI decides. | Verified only in CI. | Open (carried to the wave 7 review) |
| 6 | SC-63a | Key Vault secrets reach `create-github-app-token` through step outputs (masked). Review whether to tighten. | Credential-path hygiene. | Open (carried to the wave 7 review) |
| 7 | SC-63d..f | Re-verify all action pins against the pins table with `gh api` in the wave review (only `setup-node` was re-verified by the fixer). | Supply-chain pins. | Open (carried to the wave 7 review) |
| 8 | SC-64b/c | `upgrade` was added to the verb allow-list in `geldar-play` (card said not to edit it); accepted. Owner decision 7 default applies (print the cosign command, run no cosign). | Recorded deviation. | Open (carried to the wave 7 review) |
| 9 | SC-61e | `coverage.test.ts` is red by design until all marker and script packets have merged; confirm it is green after SC-61f, SC-61g and SC-61h. | Wave join. | Open (carried to the wave 7 review) |
| 10 | Wave 5 | N4 state-dir permissions, N6 `.cmd` shim quoting, N8 seam gating: carried by SC-60o, 60p, 60q, 60s. | Open security items. | Open (carried to the wave 7 review) |
| 11 | SC-60o | OPEN DESIGN QUESTION: session dir is now 0700 and start.bundle 0600, but the helper container (workspace-init) mounts <state>/<id>/session as /in and runs as uid 1000 with cap-drop ALL; on a Linux host whose uid is not 1000 (CI runner is 1001) it cannot even traverse the 0700 dir, so the e2e and session flows may break. Options: (a) run the helper containers with --user <host uid>:<host gid> for the read stage; (b) keep the secret bundles in a 0700 dir and hand the helper a 0644 copy in a short-lived 0755 dir removed after the stage; (c) accept 0755 on the session dir with the bundle not secret (rejected by N4). Decide from the CI result; not for the owner unless it changes what other users can read. | Real break risk on Linux, found by the coder reading the code. | Resolved in 479246d (B1: helpers mount a staged 0755/0644 copy) |

Also resolved in 479246d from the review lists: S6 (`upgrade` pins `ghcr.io/sandboxservers/geldar-kit@sha256:`) and N-e (NTFS `.git.` and `.git ` names in `up_validate`). Item 7 (action pins) and item 6 are checked once in the campaign review (SC-73).
