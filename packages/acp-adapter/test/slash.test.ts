import { describe, expect, it } from 'vitest';

import { detectSlashIntent, parseSlashInput } from '../src/slash';

describe('slash', () => {
  describe('parseSlashInput', () => {
    it('returns null for non-slash input or a slash without a name', () => {
      for (const input of ['hello', '', '/', '/   ', '/a/b']) {
        expect(parseSlashInput(input)).toBeNull();
      }
    });

    it('parses a bare command', () => {
      expect(parseSlashInput('/status')).toEqual({ name: 'status', args: '' });
    });

    it('parses command arguments without collapsing their internal whitespace', () => {
      expect(parseSlashInput('/compact keep errors and results')).toEqual({
        name: 'compact', args: 'keep errors and results',
      });
      expect(parseSlashInput('/compact    keep   results   ')).toEqual({
        name: 'compact', args: 'keep   results',
      });
    });
  });

  describe('detectSlashIntent', () => {
    it.each(['compact', 'status', 'usage', 'tasks', 'help'])(
      'routes native /%s without arguments',
      (name) => {
        expect(detectSlashIntent(`/${name}`)).toEqual({ kind: 'builtin', name, args: '' });
      },
    );

    it('preserves explicit compaction instructions', () => {
      expect(detectSlashIntent('/compact summarize aggressively')).toEqual({
        kind: 'builtin', name: 'compact', args: 'summarize aggressively',
      });
    });

    it.each(['clear', 'unknown', 'skill:foo', 'plan'])(
      'reports unsupported /%s locally rather than forwarding to the model',
      (name) => {
        expect(detectSlashIntent(`/${name} argument`)).toEqual({
          kind: 'unknown', name, args: 'argument',
        });
      },
    );

    it.each(['hello', 'please /status', '/a/b', '/', ' /status'])(
      'passes through non-leading-command text %s',
      (text) => expect(detectSlashIntent(text)).toEqual({ kind: 'passthrough' }),
    );
  });
});
