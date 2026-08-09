import { describe, expect, it } from 'vitest';

import {
  tokenPlanImageApiUrl,
  tokenPlanOriginFromBaseUrl,
  tokenPlanTaskApiUrl,
  tokenPlanVideoApiUrl,
} from '../../src/tools/builtin/media/token-plan-endpoints';

describe('tokenPlan endpoints', () => {
  it('defaults to the Singapore Global origin', () => {
    expect(tokenPlanOriginFromBaseUrl(undefined)).toBe(
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com',
    );
    expect(tokenPlanImageApiUrl()).toContain('ap-southeast-1');
    expect(tokenPlanVideoApiUrl()).toContain('video-synthesis');
    expect(tokenPlanTaskApiUrl()).toMatch(/\/api\/v1\/tasks$/);
  });

  it('derives media hosts from a China chat base URL', () => {
    const cn =
      'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
    expect(tokenPlanOriginFromBaseUrl(cn)).toBe(
      'https://token-plan.cn-beijing.maas.aliyuncs.com',
    );
    expect(tokenPlanImageApiUrl(cn)).toBe(
      'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(tokenPlanVideoApiUrl(cn)).toBe(
      'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    );
    expect(tokenPlanTaskApiUrl(cn)).toBe(
      'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/tasks',
    );
  });

  it('ignores non-Token Plan hosts', () => {
    expect(tokenPlanOriginFromBaseUrl('https://api.openai.com/v1')).toBe(
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com',
    );
  });
});
