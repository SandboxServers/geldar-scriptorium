# Upgrade and restart plan for a kit release

This is a plan for the owner to approve. Nothing here runs by itself. Host numbers (load, container counts) are for the operator to check against the real host.

## Before anything starts

- The release tag exists and the release workflow is green.
- A Mind is skipped, and retried later, when it is mid-errand, hurt or in danger. Skipped Minds go to the end of the next batch.
- The operator confirms host idle percentage first. The Mind host is near its CPU limit, so nothing starts if idle is low.

## Order and size

1. Originals first, then the +31 group, then the +50 group.
2. Batches of 5 Minds. At least 10 minutes between batches.
3. Upgrade PRs for a batch go out together with the restart batch. Opening all PRs ahead of time is allowed, because a PR alone changes nothing on a Mind.

## Per batch

1. Merge the upgrade PRs of the batch (decision 0394).
2. Restart the 5 Minds through the launcher, one after another.
3. Check each supervisor's first waking: it started, called the world and the run ended with a normal result.
4. Check host idle percentage. If it stays low, or any Mind fails to wake, stop and report.
5. Wait the gap, then start the next batch.

## Stop conditions

- CI red on any upgrade PR.
- A Mind does not wake after its restart.
- Host load stays high after the gap.

In each case stop, leave the rest unchanged and report to the owner.

## What is not touched

Memory is never changed by an upgrade. Nothing in this plan turns the instinct step on. That is a separate activation change.
