import { describe, expect, it, afterEach } from 'vitest';

import {
  fallbackExpertPersonaText,
  hydrateExpertCatalogEntry,
} from '../../src/expert-agents/catalog';
import {
  loadExpertPersonaText,
  resetExpertPersonaCacheForTests,
} from '../../src/expert-agents/catalog-persona-loader';
import type { ExpertCatalogEntry } from '../../src/expert-agents/types';

describe('catalog-persona-loader', () => {
  afterEach(() => {
    resetExpertPersonaCacheForTests();
  });

  it('loads persona text for a known expert id', () => {
    const text = loadExpertPersonaText('engineering-frontend-developer');
    expect(typeof text).toBe('string');
    expect(text!.length).toBeGreaterThan(100);
  });

  it('returns undefined for unknown expert ids without throwing', () => {
    expect(loadExpertPersonaText('definitely-not-a-real-expert-id-xyz')).toBeUndefined();
  });
});

describe('hydrateExpertCatalogEntry fallback', () => {
  it('fills a non-empty fallback persona when JSON body is missing', () => {
    const entry: ExpertCatalogEntry = {
      id: 'synthetic-missing-persona-expert',
      name: 'Synthetic Expert',
      emoji: '🧪',
      color: '#abc',
      division: 'engineering',
      divisionLabel: 'Engineering',
      divisionIcon: '⚙️',
      divisionColor: '#0af',
      description: 'Synthetic specialist for unit tests.',
      vibe: 'precise',
      tags: ['test'],
      capabilities: ['unit testing'],
      whenToUse: 'When testing persona fallbacks.',
      personaText: '',
    };
    const hydrated = hydrateExpertCatalogEntry(entry);
    expect(hydrated?.personaText.length).toBeGreaterThan(40);
    expect(hydrated?.personaText).toContain('Synthetic Expert');
    expect(fallbackExpertPersonaText(entry)).toContain('Engineering');
  });
});
