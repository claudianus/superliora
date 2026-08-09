/**
 * Derive Token Plan media API URLs from the chat completions base URL so
 * China / custom regional hosts stay consistent with the configured provider.
 */

const DEFAULT_TOKEN_PLAN_ORIGIN = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com';

/** Origin for Token Plan DashScope-style APIs (image / video / tasks). */
export function tokenPlanOriginFromBaseUrl(baseUrl?: string): string {
  if (baseUrl !== undefined && baseUrl.trim().length > 0) {
    try {
      const url = new URL(baseUrl.trim());
      if (url.hostname.includes('token-plan') && url.hostname.includes('maas.aliyuncs.com')) {
        return url.origin;
      }
    } catch {
      // Fall through to the Singapore Global default.
    }
  }
  return DEFAULT_TOKEN_PLAN_ORIGIN;
}

export function tokenPlanImageApiUrl(baseUrl?: string): string {
  return `${tokenPlanOriginFromBaseUrl(baseUrl)}/api/v1/services/aigc/multimodal-generation/generation`;
}

export function tokenPlanVideoApiUrl(baseUrl?: string): string {
  return `${tokenPlanOriginFromBaseUrl(baseUrl)}/api/v1/services/aigc/video-generation/video-synthesis`;
}

export function tokenPlanTaskApiUrl(baseUrl?: string): string {
  return `${tokenPlanOriginFromBaseUrl(baseUrl)}/api/v1/tasks`;
}
