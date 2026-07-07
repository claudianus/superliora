import { describe, it, expect } from 'vitest';
import { hasSlopPatterns, unslopText } from '../../src/utils/unslop';

describe('unslopText', () => {
  it('should replace English AI buzzwords with plain alternatives', () => {
    const input = 'We leverage cutting-edge technology to utilize robust and streamline solutions.';
    const expected = 'We use modern technology to use reliable and simplify solutions.';
    expect(unslopText(input)).toBe(expected);
  });

  it('should remove English filler phrases', () => {
    const input =
      "In today's rapidly evolving world, it is worth noting that we are making progress. Moreover, it is key. In conclusion, thank you.";
    const expected = 'we are making progress. also, it is key. thank you.';
    expect(unslopText(input)).toBe(expected);
  });

  it('should clean up Korean translation slop and make it natural', () => {
    const input = '이 플러그인은 추가 기능을 제공하는 역할을 합니다. 이를 통해 사용자는 빠른 검색을 할 수 있습니다.';
    const expected = '이 플러그인은 추가 기능을 제공합니다. 이로 사용자는 빠른 검색을 할 수 있습니다.';
    expect(unslopText(input)).toBe(expected);
  });

  it('should leave clean short text unchanged', () => {
    const input = 'Tests passed. Ready to merge.';
    expect(unslopText(input)).toBe(input);
  });

  it('should leave code-heavy text unchanged', () => {
    const input = 'Use `pnpm run build` and check `dist/main.mjs`.';
    expect(unslopText(input)).toBe(input);
  });

  it('hasSlopPatterns detects buzzwords without mutating', () => {
    expect(hasSlopPatterns('We leverage robust APIs for this integration layer.')).toBe(true);
    expect(hasSlopPatterns('ok')).toBe(false);
  });
});
