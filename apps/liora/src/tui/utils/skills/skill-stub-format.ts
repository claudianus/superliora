/**
 * Trace→Skill draft stub — formats a minimal SKILL.md skeleton from a title (SSOT §9.2 / W9).
 * Session-end suggest pipeline is manual merge only; this helper is for copy/paste drafts.
 */

function slugifySkillName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'untitled-skill';
}

/** Format a read-only SKILL.md stub from a human title (Trace→Skill manual merge). */
export function formatSkillStubFromTitle(title: string): string {
  const trimmed = title.trim();
  const displayTitle = trimmed.length > 0 ? trimmed : 'Untitled skill';
  const name = slugifySkillName(displayTitle);

  return `---
name: ${name}
description: >
  ${displayTitle}. Draft from session trace — review and merge manually before catalog use.
disable-model-invocation: true
---

# ${displayTitle}

<!-- Trace→Skill draft: edit before enabling SearchSkill discovery. -->

## When to use

- (fill in trigger scenarios distilled from the session)

## Workflow

1. (fill in steps distilled from the session)
`;
}
