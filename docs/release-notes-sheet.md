# Kit release notes: kit-v0.2.0 (draft, release is manual)

Baseline: stable kit-v0.1.1. The tag number is the owner's to choose; 0.2.0 is proposed because the release adds a supervisor step and launcher verbs.

## What reaches a player's text

- The instructions no longer say "At night, find a bed and sleep in it." The play skill drops its night and bed step, and its first step says `days_since_sleep` counts the days since you last slept.
- The night-safety skill states the night-skip fact and that phantoms do not appear in this world. A bed can be used at night.
- The social lines for the prompt (HC-29) are in the kit, with owner-approved wording, and are not turned on by this release.

## New and off by default

- The instinct step (`geldar-instinct`): the supervisor can run it before each waking. It stays off unless `GELDAR_INSTINCT` is on, and no effect runs until the activation change registers them.
- The character sheet: `geldar-play new --sheet` and `geldar-play sheet-set` store a sheet privately for a player. Start and restart deliver the stored sheet, and a roster file when one is stored, into the supervisor volume through one throwaway container with no network. The model never sees either file.
- The sanity check (`GELDAR_INSTINCT_SANITY`, default off): when on, the loop for the chatgpt and local harnesses gets its five parameters on descriptor 4. The claude harness gets nothing.
- Agent positions and the name roster reader for the instinct step.
- `docs/instinct.md` for operators.

## Fixes

- `geldar-play deploy-key` now sets the key's owner and mode through a short root helper, so the keeper (uid 1002) can read it. Hosts that used the manual `chown` workaround are unaffected.

## Unchanged

With nothing turned on, a player's child environment, arguments and files are the same as in 0.1.1. A test holds a golden for this.

## Order

1. Merge the kit PR and the activation PR (the activation PR is separate).
2. The owner tags the release.
3. Per-player upgrade PRs go out in batches. A Mind picks up the new text only after its upgrade PR is merged and it restarts. See `docs/upgrade-restart-plan.md`.
