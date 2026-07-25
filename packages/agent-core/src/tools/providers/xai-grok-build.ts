/**
 * xAI Grok Build (subscription) media + web-search client.
 *
 * Mirrors the public contracts used by xai-org/grok-build:
 * - web_search  → POST {base}/responses with tools: [{ type: "web_search" }]
 * - image_gen   → POST {base}/images/generations (b64_json)
 * - video_gen   → POST {base}/videos/generations then poll GET {base}/videos/{id}
 *
 * Auth is the same OAuth/API-key bearer the session uses for Grok chat.
 * Build proxy requests also send the official CLI surface headers.
 */

import {
  isXaiGrokBuildBaseUrl,
  XAI_GROK_BUILD_BASE_URL,
  xaiGrokBuildRequestHeaders,
} from '@superliora/oauth';

import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';

// ── Constants (aligned with grok-build crates) ─────────────────────────────

export const XAI_IMAGINE_IMAGE_MODEL = 'grok-imagine-image-quality';
export const XAI_IMAGINE_VIDEO_MODEL = 'grok-imagine-video';
export const XAI_IMAGINE_VIDEO_QUALITY_MODEL = 'grok-imagine-video-1.5-preview';
export const XAI_DEFAULT_WEB_SEARCH_MODEL = 'grok-4.5';

const IMAGE_GEN_TIMEOUT_MS = 300_000;
const VIDEO_START_TIMEOUT_MS = 60_000;
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 300_000;
const VIDEO_POLL_REQUEST_TIMEOUT_MS = 30_000;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000;
const WEB_SEARCH_TIMEOUT_MS = 120_000;

const VALID_IMAGE_ASPECT_RATIOS = new Set([
  '1:1',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  'auto',
]);

const VALID_VIDEO_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '3:2', '2:3']);
const VALID_VIDEO_RESOLUTIONS = new Set(['480p', '720p']);
const VALID_VIDEO_DURATIONS = new Set([6, 10]);

// ── Auth / credentials ─────────────────────────────────────────────────────

export interface XaiGrokTokenProvider {
  getAccessToken(options?: { readonly force?: boolean }): Promise<string>;
}

export interface XaiGrokBuildClientOptions {
  /** OpenAI-compatible base URL ending with /v1 (Build proxy or api.x.ai). */
  readonly baseUrl?: string;
  /** Static bearer (API key). Prefer tokenProvider for OAuth sessions. */
  readonly apiKey?: string;
  readonly tokenProvider?: XaiGrokTokenProvider;
  /** Extra headers (usually Build surface headers). */
  readonly customHeaders?: Record<string, string>;
  readonly webSearchModel?: string;
  readonly imageModel?: string;
  readonly videoModel?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface XaiGeneratedImage {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly model: string;
}

export interface XaiGeneratedVideo {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly model: string;
}

export interface XaiImageGenInput {
  readonly prompt: string;
  /** e.g. 1:1, 16:9, 9:16 — default auto */
  readonly aspectRatio?: string;
  readonly model?: string;
}

export interface XaiVideoGenInput {
  readonly prompt: string;
  readonly durationSeconds?: number;
  readonly aspectRatio?: string;
  /** 480p | 720p */
  readonly resolution?: string;
  /** data: URL or https URL for first-frame i2v */
  readonly imageUrl?: string;
  /** data: or https URLs for reference-to-video (max 7) */
  readonly referenceImageUrls?: readonly string[];
  readonly model?: string;
  readonly quality?: boolean;
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = trimBaseUrl(baseUrl);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function resolveXaiGrokBuildBaseUrl(baseUrl?: string): string {
  const explicit = nonEmpty(baseUrl);
  if (explicit !== undefined) return trimBaseUrl(explicit);
  return trimBaseUrl(XAI_GROK_BUILD_BASE_URL);
}

export function buildXaiGrokRequestHeaders(input: {
  readonly baseUrl: string;
  readonly customHeaders?: Record<string, string>;
  readonly model?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(input.customHeaders ?? {}),
  };
  if (isXaiGrokBuildBaseUrl(input.baseUrl)) {
    Object.assign(headers, xaiGrokBuildRequestHeaders(input.model));
  }
  return headers;
}

// ── Client ─────────────────────────────────────────────────────────────────

export class XaiGrokBuildClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly tokenProvider: XaiGrokTokenProvider | undefined;
  private readonly customHeaders: Record<string, string>;
  private readonly webSearchModel: string;
  private readonly imageModel: string;
  private readonly videoModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: XaiGrokBuildClientOptions) {
    this.baseUrl = resolveXaiGrokBuildBaseUrl(options.baseUrl);
    this.apiKey = nonEmpty(options.apiKey);
    this.tokenProvider = options.tokenProvider;
    this.customHeaders = { ...(options.customHeaders ?? {}) };
    this.webSearchModel = nonEmpty(options.webSearchModel) ?? XAI_DEFAULT_WEB_SEARCH_MODEL;
    this.imageModel = nonEmpty(options.imageModel) ?? XAI_IMAGINE_IMAGE_MODEL;
    this.videoModel = nonEmpty(options.videoModel) ?? XAI_IMAGINE_VIDEO_MODEL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async hasCredentials(): Promise<boolean> {
    if (this.apiKey !== undefined) return true;
    if (this.tokenProvider === undefined) return false;
    try {
      const token = await this.tokenProvider.getAccessToken();
      return token.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async resolveBearer(force = false): Promise<string> {
    if (this.tokenProvider !== undefined) {
      try {
        const token = await this.tokenProvider.getAccessToken({ force });
        const trimmed = token.trim();
        if (trimmed.length > 0) return trimmed;
      } catch {
        // fall through to static api key
      }
    }
    if (this.apiKey !== undefined) return this.apiKey;
    throw new Error(
      'xAI Grok credentials are not available. Sign in with /login (xAI Grok) or set XAI_API_KEY.',
    );
  }

  private async authorizedFetch(
    url: string,
    init: RequestInit & { readonly timeoutMs?: number; readonly model?: string },
  ): Promise<Response> {
    const timeoutMs = init.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const bearer = await this.resolveBearer();
      const headers = {
        ...buildXaiGrokRequestHeaders({
          baseUrl: this.baseUrl,
          customHeaders: this.customHeaders,
          model: init.model,
        }),
        Authorization: `Bearer ${bearer}`,
        ...(init.headers as Record<string, string> | undefined),
      };
      const response = await this.fetchImpl(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (response.status === 401 && this.tokenProvider !== undefined) {
        // One forced refresh retry for rotated OAuth tokens.
        const refreshed = await this.resolveBearer(true);
        const retryHeaders = {
          ...headers,
          Authorization: `Bearer ${refreshed}`,
        };
        return await this.fetchImpl(url, {
          ...init,
          headers: retryHeaders,
          signal: controller.signal,
        });
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Web search (Responses API + web_search tool) ───────────────────────

  async search(
    query: string,
    options?: { readonly limit?: number; readonly allowedDomains?: readonly string[] },
  ): Promise<WebSearchResult[]> {
    const q = query.trim();
    if (q.length === 0) {
      throw new Error('web search query must not be empty');
    }

    const webSearchTool: Record<string, unknown> = { type: 'web_search' };
    if (options?.allowedDomains !== undefined && options.allowedDomains.length > 0) {
      webSearchTool['filters'] = { allowed_domains: [...options.allowedDomains] };
    }

    const body = {
      model: this.webSearchModel,
      input: q,
      tools: [webSearchTool],
      store: false,
      temperature: 0.1,
      top_p: 0.95,
      max_output_tokens: 8192,
    };

    const response = await this.authorizedFetch(joinUrl(this.baseUrl, '/responses'), {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: WEB_SEARCH_TIMEOUT_MS,
      model: this.webSearchModel,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `xAI web_search failed (${String(response.status)}): ${truncate(text, 400)}`,
      );
    }

    const payload = (await response.json()) as ResponsesApiPayload;
    const content = extractResponsesText(payload) || 'No search results found.';
    const citations = extractResponsesCitations(payload);
    const limit = Math.min(Math.max(options?.limit ?? 5, 1), 10);

    if (citations.length > 0) {
      // Put synthesis on the first citation so callers that only show
      // title/url/snippet still get useful context.
      return citations.slice(0, limit).map((url, index) => ({
        title: `Result ${String(index + 1)}`,
        url,
        snippet: index === 0 ? truncate(content, 400) : '',
      }));
    }

    return [
      {
        title: 'xAI web search synthesis',
        url: 'https://x.ai',
        snippet: truncate(content, 400),
      },
    ];
  }

  // ── Image generation ───────────────────────────────────────────────────

  async generateImage(input: XaiImageGenInput): Promise<XaiGeneratedImage> {
    const prompt = input.prompt.trim();
    if (prompt.length === 0) throw new Error('image prompt must not be empty');

    const aspectRatio = normalizeImageAspectRatio(input.aspectRatio);
    const model = nonEmpty(input.model) ?? this.imageModel;

    const response = await this.authorizedFetch(joinUrl(this.baseUrl, '/images/generations'), {
      method: 'POST',
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        aspect_ratio: aspectRatio,
        resolution: '1k',
        response_format: 'b64_json',
      }),
      timeoutMs: IMAGE_GEN_TIMEOUT_MS,
      model,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `xAI image generation failed (${String(response.status)}): ${truncate(text, 400)}`,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const item = payload.data?.[0];
    if (item?.b64_json !== undefined && item.b64_json.length > 0) {
      return {
        bytes: Buffer.from(item.b64_json, 'base64'),
        mimeType: 'image/jpeg',
        model,
      };
    }
    if (item?.url !== undefined && item.url.length > 0) {
      const imageResponse = await this.fetchImpl(item.url);
      if (!imageResponse.ok) {
        throw new Error(
          `Failed to download xAI image (${String(imageResponse.status)})`,
        );
      }
      const arrayBuffer = await imageResponse.arrayBuffer();
      return {
        bytes: Buffer.from(arrayBuffer),
        mimeType: imageResponse.headers.get('content-type') ?? 'image/jpeg',
        model,
      };
    }
    throw new Error('xAI image generation returned no image payload.');
  }

  // ── Video generation (async start + poll) ──────────────────────────────

  async generateVideo(input: XaiVideoGenInput): Promise<XaiGeneratedVideo> {
    const prompt = input.prompt.trim();
    if (prompt.length === 0) throw new Error('video prompt must not be empty');

    const model =
      nonEmpty(input.model) ??
      (input.quality === true ? XAI_IMAGINE_VIDEO_QUALITY_MODEL : this.videoModel);
    const duration = normalizeVideoDuration(input.durationSeconds);
    const aspectRatio = normalizeVideoAspectRatio(input.aspectRatio);
    const resolution = normalizeVideoResolution(input.resolution);

    const body: Record<string, unknown> = {
      model,
      prompt,
      resolution,
    };
    if (duration !== undefined) body['duration'] = duration;
    if (aspectRatio !== undefined) body['aspect_ratio'] = aspectRatio;
    if (input.imageUrl !== undefined && input.imageUrl.trim().length > 0) {
      body['image'] = { url: input.imageUrl.trim() };
    }
    if (input.referenceImageUrls !== undefined && input.referenceImageUrls.length > 0) {
      body['reference_images'] = input.referenceImageUrls
        .slice(0, 7)
        .map((url) => ({ url: url.trim() }))
        .filter((entry) => entry.url.length > 0);
    }

    const startResponse = await this.authorizedFetch(
      joinUrl(this.baseUrl, '/videos/generations'),
      {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: VIDEO_START_TIMEOUT_MS,
        model,
      },
    );

    if (!startResponse.ok) {
      const text = await startResponse.text().catch(() => '');
      throw new Error(
        `xAI video generation failed (${String(startResponse.status)}): ${truncate(text, 400)}`,
      );
    }

    const startPayload = (await startResponse.json()) as { request_id?: string };
    const requestId = nonEmpty(startPayload.request_id);
    if (requestId === undefined) {
      throw new Error('xAI video generation returned no request_id.');
    }

    const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(VIDEO_POLL_INTERVAL_MS);
      const pollResponse = await this.authorizedFetch(
        joinUrl(this.baseUrl, `/videos/${encodeURIComponent(requestId)}`),
        {
          method: 'GET',
          timeoutMs: VIDEO_POLL_REQUEST_TIMEOUT_MS,
          model,
        },
      );

      if (!pollResponse.ok && pollResponse.status !== 202) {
        const text = await pollResponse.text().catch(() => '');
        throw new Error(
          `xAI video poll failed (${String(pollResponse.status)}): ${truncate(text, 400)}`,
        );
      }

      const pollPayload = (await pollResponse.json()) as {
        status?: string;
        video?: { url?: string };
      };
      const status = (pollPayload.status ?? '').toLowerCase();
      if (status === 'done' || status === 'completed' || status === 'succeeded') {
        const videoUrl = nonEmpty(pollPayload.video?.url);
        if (videoUrl === undefined) {
          throw new Error('xAI video generation completed without a video URL.');
        }
        const download = await this.fetchImpl(videoUrl, {
          signal: AbortSignal.timeout(VIDEO_DOWNLOAD_TIMEOUT_MS),
        });
        if (!download.ok) {
          throw new Error(
            `Failed to download xAI video (${String(download.status)})`,
          );
        }
        const arrayBuffer = await download.arrayBuffer();
        return {
          bytes: Buffer.from(arrayBuffer),
          mimeType: download.headers.get('content-type') ?? 'video/mp4',
          model,
        };
      }
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        throw new Error(`xAI video generation ${status} (request_id=${requestId}).`);
      }
    }

    throw new Error(
      `xAI video generation timed out after ${String(VIDEO_POLL_TIMEOUT_MS / 1000)}s (request_id=${requestId}).`,
    );
  }
}

// ── WebSearchProvider adapter ──────────────────────────────────────────────

export class XaiGrokWebSearchProvider implements WebSearchProvider {
  constructor(private readonly client: XaiGrokBuildClient) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    return this.client.search(query, {
      limit: options?.limit,
    });
  }
}

/**
 * Prefer Grok Build search when the subscription session is signed in,
 * then fall back to the multi-provider research stack.
 */
export class PreferXaiGrokWebSearchProvider implements WebSearchProvider {
  constructor(
    private readonly xai: WebSearchProvider,
    private readonly fallback: WebSearchProvider,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    try {
      return await this.xai.search(query, options);
    } catch {
      return this.fallback.search(query, options);
    }
  }
}

// ── Availability helpers ───────────────────────────────────────────────────

export interface XaiGrokCredentialProbe {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly tokenProvider?: XaiGrokTokenProvider;
}

export function isXaiGrokCredentialConfigured(probe: XaiGrokCredentialProbe): boolean {
  if (nonEmpty(probe.apiKey) !== undefined) return true;
  if (nonEmpty(process.env['XAI_API_KEY']) !== undefined) return true;
  return probe.tokenProvider !== undefined;
}

export function createXaiGrokBuildClientFromEnv(
  options: Omit<XaiGrokBuildClientOptions, 'apiKey'> & { readonly apiKey?: string } = {},
): XaiGrokBuildClient | undefined {
  const apiKey =
    nonEmpty(options.apiKey) ?? nonEmpty(process.env['XAI_API_KEY']);
  if (apiKey === undefined && options.tokenProvider === undefined) return undefined;
  return new XaiGrokBuildClient({
    ...options,
    apiKey,
  });
}

// ── Response parsing ───────────────────────────────────────────────────────

interface ResponsesApiPayload {
  readonly output_text?: string;
  readonly output?: readonly ResponsesOutputItem[];
}

interface ResponsesOutputItem {
  readonly type?: string;
  readonly content?: readonly ResponsesContentPart[];
  readonly text?: string;
}

interface ResponsesContentPart {
  readonly type?: string;
  readonly text?: string;
  readonly annotations?: readonly ResponsesAnnotation[];
}

interface ResponsesAnnotation {
  readonly type?: string;
  readonly url?: string;
  readonly title?: string;
}

function extractResponsesText(payload: ResponsesApiPayload): string {
  const direct = nonEmpty(payload.output_text);
  if (direct !== undefined) return direct;

  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    if (typeof item.text === 'string' && item.text.length > 0) {
      chunks.push(item.text);
    }
    for (const part of item.content ?? []) {
      if (
        (part.type === 'output_text' || part.type === 'text' || part.type === undefined) &&
        typeof part.text === 'string' &&
        part.text.length > 0
      ) {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function extractResponsesCitations(payload: ResponsesApiPayload): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      for (const annotation of part.annotations ?? []) {
        const url = nonEmpty(annotation.url);
        if (url === undefined) continue;
        if (annotation.type !== undefined && annotation.type !== 'url_citation') continue;
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

function normalizeImageAspectRatio(value: string | undefined): string {
  const raw = nonEmpty(value) ?? 'auto';
  return VALID_IMAGE_ASPECT_RATIOS.has(raw) ? raw : 'auto';
}

function normalizeVideoAspectRatio(value: string | undefined): string | undefined {
  const raw = nonEmpty(value);
  if (raw === undefined) return undefined;
  return VALID_VIDEO_ASPECT_RATIOS.has(raw) ? raw : '16:9';
}

function normalizeVideoResolution(value: string | undefined): string {
  const raw = (nonEmpty(value) ?? '480p').toLowerCase();
  if (raw === '720p' || raw === '720') return '720p';
  if (VALID_VIDEO_RESOLUTIONS.has(raw)) return raw;
  return '480p';
}

function normalizeVideoDuration(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return 6;
  const rounded = Math.round(value);
  if (VALID_VIDEO_DURATIONS.has(rounded)) return rounded;
  // Map nearby values onto allowed set used by Imagine video.
  return rounded >= 8 ? 10 : 6;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
