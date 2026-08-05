import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyPersonaSkillBundle } from '#/tui/utils/persona/apply-skill-bundle';
import { saveSkillsState } from '#/utils/skills/skills-state';

describe('applyPersonaSkillBundle', () => {
  it('enables listed skills without wiping unrelated disables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'persona-skills-'));
    const statePath = join(dir, 'skills-state.json');
    await saveSkillsState({ disabled: ['keep-disabled', 'avoid-ai-writing'] }, statePath);
    const result = await applyPersonaSkillBundle(
      {
        enableSkills: ['avoid-ai-writing'],
        disableSkills: ['noise-skill'],
      },
      statePath,
    );
    expect(result.enabled).toEqual(['avoid-ai-writing']);
    expect(result.disabled).toEqual(['noise-skill']);
    const raw = JSON.parse(await readFile(statePath, 'utf-8')) as { disabled: string[] };
    expect(raw.disabled).toEqual(['keep-disabled', 'noise-skill']);
  });
});
