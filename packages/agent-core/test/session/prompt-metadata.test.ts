import type { ContentPart } from '@superliora/kosong';
import type { ActivatePluginCommandPayload, ActivateSkillPayload, PromptPayload } from '#/rpc';
import { describe, expect, it } from 'vitest';

import {
  promptMetadataTextFromPayload,
  promptMetadataTextFromPluginCommand,
  promptMetadataTextFromSkill,
  titleFromPromptMetadataText,
} from '../../src/session/prompt-metadata';

function textPart(text: string): ContentPart {
  return { type: 'text', text };
}

describe('prompt-metadata.ts — titleFromPromptMetadataText', () => {
  it('slices to the 200-char title cap', () => {
    expect(titleFromPromptMetadataText('a'.repeat(500)).length).toBe(200);
    expect(titleFromPromptMetadataText('short')).toBe('short');
  });
});

describe('prompt-metadata.ts — promptMetadataTextFromPayload', () => {
  it('joins text parts, replaces image with [image], drops empty parts and think blocks', () => {
    const payload: PromptPayload = {
      input: [
        textPart('hello world'),
        { type: 'image_url', imageUrl: { url: 'http://x' } },
        textPart('   '), // empty after trim
        textPart('second line'),
        { type: 'think', think: 'hidden' },
      ],
    };
    // think parts are not surfaced as text; the empty-trim text is also
    // dropped. Only the image placeholder is appended inline.
    expect(promptMetadataTextFromPayload(payload)).toBe('hello world [image] second line');
  });

  it('redacts secrets (bearer, api_key, password, sk-, long base64-ish, control chars, RSA private key)', () => {
    const payload: PromptPayload = {
      input: [
        textPart(
          [
            'Authorization: Bearer sk_live_abcdefghijklmnop1234',
            'api_key="AKIA_ABCDEFGHIJKLMNOPQR"',
            'password=hunter2',
            '-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----',
            'sk-1234567890abcdefghij',
            'b'.repeat(80),
            '\u0007\u0000ctrl',
          ].join('\n'),
        ),
      ],
    };
    const out = promptMetadataTextFromPayload(payload) ?? '';
    expect(out).toContain('Authorization: Bearer [redacted]');
    expect(out).toContain('api_key=[redacted]');
    expect(out).toContain('password=[redacted]');
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('sk_live_abcdefghijklmnop1234');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('BEGIN RSA PRIVATE KEY');
    // The whole RSA private key block is collapsed to a single [redacted]
    // marker, so the private key literal must be gone.
    expect(out).not.toMatch(/-----BEGIN/);
  });

  it('truncates the final text to at most the documented 4000-char cap', () => {
    // Use words separated by spaces so the secret redaction pass does not
    // collapse the body into a single [redacted] marker. The cap test
    // then asserts the post-truncation length is at most 4000.
    const long = Array.from({ length: 10_000 }, (_, i) => `w${i}`).join(' ');
    const payload: PromptPayload = { input: [textPart(long)] };
    const out = promptMetadataTextFromPayload(payload) ?? '';
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns undefined for an all-empty input', () => {
    const payload: PromptPayload = { input: [textPart('   '), { type: 'think', think: 'x' }] };
    expect(promptMetadataTextFromPayload(payload)).toBeUndefined();
  });
});

describe('prompt-metadata.ts — promptMetadataTextFromSkill / promptMetadataTextFromPluginCommand', () => {
  it('formats skill activation with optional args and trims args', () => {
    const a: ActivateSkillPayload = { name: 'commit', args: '  -m feat  ' };
    expect(promptMetadataTextFromSkill(a)).toBe('/commit -m feat');
  });

  it('omits the trailing space when skill args are empty/undefined', () => {
    const a1: ActivateSkillPayload = { name: 'commit', args: '   ' };
    const a2: ActivateSkillPayload = { name: 'commit' };
    expect(promptMetadataTextFromSkill(a1)).toBe('/commit');
    expect(promptMetadataTextFromSkill(a2)).toBe('/commit');
  });

  it('formats plugin command with command and optional args', () => {
    const a: ActivatePluginCommandPayload = {
      pluginId: 'p1',
      commandName: 'review',
      args: '  --strict  ',
    };
    expect(promptMetadataTextFromPluginCommand(a)).toBe('/p1:review --strict');
  });

  it('omits the trailing space when plugin args are empty', () => {
    const a: ActivatePluginCommandPayload = { pluginId: 'p1', commandName: 'review' };
    expect(promptMetadataTextFromPluginCommand(a)).toBe('/p1:review');
  });
});
