import { describe, expect, it } from 'vitest';

import { nowIsoDateTime, isoDateTimeSchema } from '../time';
import { cursorQuerySchema, pageResponseSchema } from '../pagination';
import {
  isUlid,
  parseOrGenerateRequestId,
  ulidRegex,
} from '../request-id';
import { errEnvelope, okEnvelope, envelopeSchema } from '../envelope';
import {
  approvalDecisionSchema,
  approvalRequestSchema,
  approvalResponseSchema,
} from '../approval';
import {
  questionAnswerSchema,
  questionItemSchema,
  questionRequestSchema,
  questionResponseSchema,
} from '../question';

describe('protocol/time — iso datetime', () => {
  it('isoDateTimeSchema normalizes an ISO string', () => {
    const v = isoDateTimeSchema.parse('2026-01-02T03:04:05Z');
    expect(v).toBe('2026-01-02T03:04:05.000Z');
  });

  it('isoDateTimeSchema rejects a non-ISO string', () => {
    expect(() => isoDateTimeSchema.parse('not a date')).toThrow();
  });

  it('nowIsoDateTime returns a parseable value', () => {
    const v = nowIsoDateTime();
    expect(isoDateTimeSchema.parse(v)).toBe(v);
  });
});

describe('protocol/pagination — cursor + page', () => {
  it('cursorQuerySchema accepts either before or after id', () => {
    expect(cursorQuerySchema.parse({ before_id: 'a' }).before_id).toBe('a');
    expect(cursorQuerySchema.parse({ after_id: 'a' }).after_id).toBe('a');
  });

  it('cursorQuerySchema rejects when both before_id and after_id are present', () => {
    expect(() =>
      cursorQuerySchema.parse({ before_id: 'a', after_id: 'b' }),
    ).toThrow();
  });

  it('cursorQuerySchema rejects a page_size outside 1..100', () => {
    expect(() => cursorQuerySchema.parse({ page_size: 0 })).toThrow();
    expect(() => cursorQuerySchema.parse({ page_size: 101 })).toThrow();
  });

  it('pageResponseSchema wraps items with has_more', () => {
    const page = pageResponseSchema(z.object({ id: z.string() })).parse({
      items: [{ id: 'a' }],
      has_more: false,
    });
    expect(page.has_more).toBe(false);
  });
});

describe('protocol/request-id — ulid helpers', () => {
  it('parseOrGenerateRequestId returns the input when valid', () => {
    const v = parseOrGenerateRequestId(undefined);
    expect(parseOrGenerateRequestId(v)).toBe(v);
  });

  it('parseOrGenerateRequestId generates when invalid', () => {
    const v = parseOrGenerateRequestId(undefined);
    expect(isUlid(v)).toBe(true);
  });

  it('ulidRegex matches canonical ULID', () => {
    const v = parseOrGenerateRequestId(undefined);
    expect(ulidRegex.test(v)).toBe(true);
    expect(ulidRegex.test('not-a-ulid')).toBe(false);
  });
});

describe('protocol/envelope — envelope helpers', () => {
  it('okEnvelope builds a success envelope', () => {
    const env = okEnvelope({ x: 1 }, parseOrGenerateRequestId(undefined));
    expect(env.code).toBe(0);
    expect(env.data).toEqual({ x: 1 });
  });

  it('errEnvelope builds an error envelope with null data', () => {
    const env = errEnvelope(404, 'not found', parseOrGenerateRequestId(undefined));
    expect(env.data).toBeNull();
    expect(env.code).toBe(404);
  });

  it('envelopeSchema round-trips okEnvelope', () => {
    const schema = envelopeSchema(
      z.object({ items: z.array(z.string()) }),
    );
    const env = okEnvelope({ items: ['a'] }, parseOrGenerateRequestId(undefined));
    const parsed = schema.parse(env);
    expect(parsed.code).toBe(0);
  });
});

import { z } from 'zod';

describe('protocol/approval — approval lifecycle', () => {
  it('approvalDecisionSchema accepts the canonical decisions', () => {
    for (const v of ['approved', 'rejected', 'cancelled']) {
      expect(approvalDecisionSchema.parse(v)).toBe(v);
    }
    expect(() => approvalDecisionSchema.parse('maybe')).toThrow();
  });

  it('approvalRequestSchema accepts a minimal request', () => {
    const r = approvalRequestSchema.parse({
      approval_id: 'a-1',
      session_id: 's-1',
      tool_call_id: 't-1',
      tool_name: 'Bash',
      action: 'run',
      tool_input_display: { kind: 'command', command: 'ls' },
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-01T00:01:00Z',
    });
    expect(r.tool_name).toBe('Bash');
  });

  it('approvalResponseSchema accepts a session-scoped response', () => {
    const r = approvalResponseSchema.parse({
      decision: 'approved',
      scope: 'session',
    });
    expect(r.decision).toBe('approved');
  });
});

describe('protocol/question — question lifecycle', () => {
  it('questionItemSchema requires 2..4 options', () => {
    const base = {
      id: 'q-1',
      question: 'pick one',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    };
    expect(questionItemSchema.parse(base).id).toBe('q-1');
    expect(() => questionItemSchema.parse({ ...base, options: [{ id: 'a', label: 'A' }] })).toThrow();
    expect(() =>
      questionItemSchema.parse({
        ...base,
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
          { id: 'd', label: 'D' },
          { id: 'e', label: 'E' },
        ],
      }),
    ).toThrow();
  });

  it('questionRequestSchema requires 1..4 questions', () => {
    const base = {
      question_id: 'q-1',
      session_id: 's-1',
      questions: [
        {
          id: 'q-1',
          question: 'pick one',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(questionRequestSchema.parse(base).question_id).toBe('q-1');
    expect(() => questionRequestSchema.parse({ ...base, questions: [] })).toThrow();
  });

  it('questionAnswerSchema accepts all answer kinds', () => {
    expect(questionAnswerSchema.parse({ kind: 'single', option_id: 'a' }).kind).toBe('single');
    expect(questionAnswerSchema.parse({ kind: 'multi', option_ids: ['a'] }).kind).toBe('multi');
    expect(questionAnswerSchema.parse({ kind: 'other', text: 'x' }).kind).toBe('other');
    expect(
      questionAnswerSchema.parse({
        kind: 'multi_with_other',
        option_ids: ['a'],
        other_text: 'x',
      }).kind,
    ).toBe('multi_with_other');
    expect(questionAnswerSchema.parse({ kind: 'skipped' }).kind).toBe('skipped');
  });

  it('questionResponseSchema accepts an answers record', () => {
    const r = questionResponseSchema.parse({
      answers: { 'q-1': { kind: 'skipped' } },
    });
    expect(r.answers['q-1'].kind).toBe('skipped');
  });
});
