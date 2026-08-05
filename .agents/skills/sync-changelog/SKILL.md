---
name: sync-changelog
description: Refresh the English reference changelog after an explicitly requested release-docs sync.
---

# Sync Changelog

This is optional archive maintenance, not part of every release or product
change. Use it only when a released version is missing from
`docs/en/release-notes/changelog.md`.

## Source and target

- Source: `apps/liora/CHANGELOG.md` (generated; never edit it)
- Target: `docs/en/release-notes/changelog.md` (English archive)

## Workflow

1. Confirm the version has been released and exists in the source changelog.
2. Copy only the missing version blocks into the English archive.
3. Remove changeset headings, PR links, and commit-hash decorations while
   preserving the user-facing entry text and release date.
4. Keep examples neutral and do not add unreleased changeset drafts.
5. Review the diff and leave all other docs untouched.

There is no Chinese mirror, translation step, docs build, or changeset for this
archive-only update.
