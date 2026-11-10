# Release

A kit release is one tag, `kit-vX.Y.Z`. The tag names three things that must agree:

- the template commit that is published to `geldar-player-template`;
- the kit image digest (`sha256:...`) that the template expects;
- the launcher version, the `geldar-play` build that goes with the kit.

## What the release workflow does

The workflow is `.github/workflows/release.yml` (added in SC-63). It runs only on `kit-v*` tags, and a failed scan stops the release. Its steps, in order:

1. **Image.** Build the kit image and push it to GHCR, pinned by digest.
2. **Sign the image.** Sign it with cosign.
3. **SBOM.** Produce a software bill of materials for the image.
4. **Scan.** Run trivy and grype on the image. Either scan fails the release on a critical finding.
5. **Launcher.** Sign the launcher assets and attach them to the release.
6. **Template.** Publish `template/` to `geldar-player-template` as one commit that names the release triple. The same job writes the image digest and version into the published `player.json` defaults.
7. **Launcher release in the template repo.** After the tag push, `publish-template.yml` creates a GitHub release of `geldar-player-template` for the same tag. It has two assets, `geldar-play-<version>.tar.gz` and `SHA256SUMS`, the files the launcher job built (the job hands them over as the `launcher-unsigned` artifact). The Patron guide's download link points there. A tag with a hyphen (`-rc1`) is a prerelease. The signatures and the SBOM stay on this repo's release. Only the `gh release create` step holds the App token, and `template-release.ts` checks that the folder holds exactly those two files and that the checksum matches. Decision 52 records why.

If the template tag exists but the release step failed, re-running the publish job publishes nothing new (the tag is already there) and retries the release step. A release that exists already makes `gh` fail, so check the template repo's releases before you re-run.

## Existing players: `geldar-play upgrade`

A player never gets a release pushed into their repo. `geldar-play upgrade` (SC-64) reaches an existing player as a pull request that the owner merges, as decided in geldar 0008. The upgrade branch replaces the kit files with the new release's template and bumps `kit_version` and `kit_image`. Memory is never touched.

## Rule: nobody edits the template by hand

Nobody edits `geldar-player-template` by hand. Its contents come only from a release, so every published commit can be traced to a tag. Changes to the player-facing files start in `template/` in this repo.
