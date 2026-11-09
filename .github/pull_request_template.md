## What changed and why

<!-- One paragraph. Name the spec section (docs/spec.md) and, for campaign work, the packet (docs/analysis/<campaign>/work-packets.md). -->

## Test plan

<!-- What you ran and what passed. Say what you could NOT test (live shard, Paper, a model). -->

- [ ] `./scriptorium.ps1 check` passes locally
- [ ] A behavior change has a test that fails when the change is reverted (I checked), or this PR changes no behavior
- [ ] New dependencies, images and actions are pinned to exact versions (actions and images by SHA or digest)
- [ ] Files under template/ follow the voice rule (player-facing only, no developer content)
- [ ] Launcher or gate changes have a hostile test (docs/launcher-hardening.md)

## Docs and decisions

<!-- Docs updated in this PR, or "none" with a reason. A settled open decision gets a record in docs/decisions/. Ideas outside the spec go in docs/ideas.md, not in code. -->

## Related

<!-- closes #NNN, packet ID, decision ID -->
