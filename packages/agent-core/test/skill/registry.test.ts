import { describe, expect, it } from 'vitest';

import { SessionSkillRegistry } from '../../src/skill';
import type { SkillDefinition, SkillSource } from '../../src/skill';

describe('skill registry prompt rendering', () => {
  it('groups skills by scope under canonical section headings', () => {
    const registry = makeRegistry([
      makeSkill('builtin-a', 'builtin'),
      makeSkill('user-a', 'user'),
      makeSkill('proj-a', 'project'),
      makeSkill('extra-a', 'extra'),
    ]);

    const rendered = registry.getKimiSkillsDescription();

    expect(rendered).toContain('### Project');
    expect(rendered).toContain('### User');
    expect(rendered).toContain('### Extra');
    expect(rendered).toContain('### Built-in');

    const projectIdx = rendered.indexOf('### Project');
    const userIdx = rendered.indexOf('### User');
    const extraIdx = rendered.indexOf('### Extra');
    const builtinIdx = rendered.indexOf('### Built-in');
    expect(projectIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(extraIdx);
    expect(extraIdx).toBeLessThan(builtinIdx);

    expect(sectionFor(rendered, '### Project')).toContain('proj-a');
    expect(sectionFor(rendered, '### User')).toContain('user-a');
    expect(sectionFor(rendered, '### Extra')).toContain('extra-a');
    expect(sectionFor(rendered, '### Built-in')).toContain('builtin-a');
    expect(sectionFor(rendered, '### Project')).not.toContain('user-a');
    expect(sectionFor(rendered, '### User')).not.toContain('proj-a');
  });

  it('omits scope headings that have no skills', () => {
    const registry = makeRegistry([makeSkill('alpha', 'user')]);

    const rendered = registry.getKimiSkillsDescription();

    expect(rendered).toContain('### User');
    expect(rendered).not.toContain('### Project');
    expect(rendered).not.toContain('### Extra');
    expect(rendered).not.toContain('### Built-in');
  });

  it('renders a "No skills" placeholder for an empty registry', () => {
    const registry = new SessionSkillRegistry();

    const rendered = registry.getKimiSkillsDescription();

    expect(rendered.trim()).not.toBe('');
    expect(/no skills/i.test(rendered)).toBe(true);
  });

  it('sorts skills alphabetically within a scope', () => {
    const registry = makeRegistry([
      makeSkill('zebra', 'user'),
      makeSkill('alpha', 'user'),
      makeSkill('mango', 'user'),
    ]);

    const rendered = registry.getKimiSkillsDescription();

    const a = rendered.indexOf('alpha');
    const m = rendered.indexOf('mango');
    const z = rendered.indexOf('zebra');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(m);
    expect(m).toBeLessThan(z);
  });

  it('end-to-end: a project skill that shadows other scopes renders once under Project', () => {
    const registry = makeRegistry([
      makeSkill('foo', 'project', 'project version', '/tmp/proj/foo/SKILL.md'),
    ]);

    const rendered = registry.getKimiSkillsDescription();

    expect(rendered.match(/\n- foo\n/g) ?? []).toHaveLength(1);
    expect(sectionFor(rendered, '### Project')).toContain('foo');
    expect(rendered).toContain('/tmp/proj/foo/SKILL.md');
    expect(rendered).toContain('project version');
  });

  it('renders each skill as name + Path + Description', () => {
    const registry = makeRegistry([
      makeSkill('alpha', 'user', 'Alpha does things', '/tmp/user/alpha/SKILL.md'),
    ]);

    const rendered = registry.getKimiSkillsDescription();

    expect(rendered).toContain('- alpha');
    expect(rendered).toContain('  - Path: /tmp/user/alpha/SKILL.md');
    expect(rendered).toContain('  - Description: Alpha does things');
  });
});

describe('model skill runtime prompt', () => {
  it('does not expand many registered skills into the model prompt', () => {
    const registry = makeRegistry(
      Array.from({ length: 1500 }, (_, index) =>
        makeSkill(`skill-${index}`, 'user', `description ${index}`),
      ),
    );

    const rendered = registry.getModelSkillListing();

    expect(rendered).toContain('SearchSkill');
    expect(rendered).toContain('English task keywords');
    expect(rendered).toContain('Translate non-English user requests');
    expect(rendered).toContain('<kimi-skill-loaded>');
    expect(rendered).not.toContain('skill-1499');
    expect(rendered).not.toContain('description 1499');
    expect(rendered.length).toBeLessThan(1500);
  });

  it('returns an empty model prompt when no skills are invocable', () => {
    const registry = makeRegistry([
      makeSkill('private', 'user', 'private', undefined, {
        type: 'prompt',
        disableModelInvocation: true,
      }),
    ]);

    expect(registry.getModelSkillListing()).toBe('');
  });
});

describe('skill search', () => {
  it('returns exact, prefix, and description matches deterministically', async () => {
    const registry = makeRegistry([
      makeSkill('docs-review', 'user', 'Review API documentation'),
      makeSkill('docs-generate', 'user', 'Generate documentation'),
      makeSkill('api-helper', 'user', 'Build REST endpoints'),
    ]);

    const exact = await registry.searchByQuery('docs-review');
    const prefix = await registry.searchByQuery('docs');
    const description = await registry.searchByQuery('REST endpoints');

    expect(exact[0]?.name).toBe('docs-review');
    expect(prefix.slice(0, 2).map((skill) => skill.name)).toEqual([
      'docs-generate',
      'docs-review',
    ]);
    expect(description[0]?.name).toBe('api-helper');
  });

  it('surfaces short skill names matched as tokens in multi-word queries', async () => {
    const registry = makeRegistry([
      makeSkill('docx', 'builtin', 'Create and edit Word documents (.docx)'),
      makeSkill('pptx', 'builtin', 'Build PowerPoint slide decks (.pptx)'),
      makeSkill('xlsx', 'builtin', 'Work with Excel spreadsheets (.xlsx)'),
      makeSkill('docx-processing-openai', 'builtin', 'Alternate Word document pipeline'),
      makeSkill('react-performance', 'user', 'Optimize React rendering'),
    ]);

    const docxHits = await registry.searchByQuery('Word docx report');
    expect(docxHits[0]?.name).toBe('docx');

    const pptxHits = await registry.searchByQuery('PowerPoint pptx slides');
    expect(pptxHits[0]?.name).toBe('pptx');

    const xlsxHits = await registry.searchByQuery('Excel xlsx spreadsheet');
    expect(xlsxHits[0]?.name).toBe('xlsx');
  });

  it('excludes private, high-risk, sub-skill, and non-inline skills from model search', async () => {
    const registry = makeRegistry([
      makeSkill('safe-match', 'user', 'secret audit helper'),
      makeSkill('private-match', 'user', 'secret audit helper', undefined, {
        type: 'prompt',
        disableModelInvocation: true,
      }),
      makeSkill('danger-match', 'user', 'secret audit helper', undefined, {
        type: 'prompt',
        risk: 'high',
      }),
      makeSkill('child-match', 'user', 'secret audit helper', undefined, {
        type: 'prompt',
        isSubSkill: true,
      }),
      makeSkill('flow-match', 'user', 'secret audit helper', undefined, {
        type: 'flow',
      }),
    ]);

    const names = (await registry.searchByQuery('secret audit')).map((skill) => skill.name);

    expect(names).toEqual(['safe-match']);
  });

  it('uses configured default and max limits', async () => {
    const registry = new SessionSkillRegistry({
      defaultSearchLimit: 2,
      maxSearchLimit: 3,
      disableCatalogLoad: true,
    });
    for (let index = 0; index < 5; index += 1) {
      registry.register(makeSkill(`match-${index}`, 'user', 'limit test'));
    }

    expect(await registry.searchByQuery('match')).toHaveLength(2);
    expect(await registry.searchByQuery('match', 99)).toHaveLength(3);
  });
});

function makeRegistry(skills: readonly SkillDefinition[]): SessionSkillRegistry {
  // Unit tests assert local registry ranking only — never pull the 7k+ catalog.
  const registry = new SessionSkillRegistry({ disableCatalogLoad: true });
  for (const skill of skills) registry.register(skill);
  return registry;
}

function makeSkill(
  name: string,
  source: SkillSource,
  description = 'desc',
  skillPath?: string,
  metadata: SkillDefinition['metadata'] = { type: 'prompt' },
): SkillDefinition {
  const finalPath = skillPath ?? `/tmp/${source}/${name}/SKILL.md`;
  return {
    name,
    description,
    path: finalPath,
    dir: finalPath.replace(/\/SKILL\.md$/, ''),
    content: '',
    metadata,
    source,
  };
}

function sectionFor(rendered: string, header: string): string {
  const start = rendered.indexOf(header);
  if (start === -1) return '';
  const next = rendered.indexOf('### ', start + header.length);
  return next === -1 ? rendered.slice(start) : rendered.slice(start, next);
}
