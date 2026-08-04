/**
 * Live Cursor model discovery via Connect JSON unary
 * `POST /aiserver.v1.AiService/AvailableModels` on api2.cursor.sh.
 *
 * Falls back to {@link CURSOR_FALLBACK_MODELS} when discovery fails.
 */

import http2 from 'node:http2';
import { randomUUID } from 'node:crypto';

import { isRecord } from '../utils';
import type { ProviderModelPreset } from './provider-profile';
import { CURSOR_CLIENT_TYPE, resolveCursorClientVersion } from './cursor-client';

const AVAILABLE_MODELS_PATH = '/aiserver.v1.AiService/AvailableModels';
const DEFAULT_API_HOST = 'https://api2.cursor.sh';
const DEFAULT_CONTEXT = 200_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface CursorDiscoveredModel {
  readonly id: string;
  readonly displayName: string;
  readonly maxContextSize: number;
  readonly capabilities: readonly string[];
  /** Server-side model name when different from the picker id. */
  readonly serverModelId?: string;
}

/** Static fallback when live discovery fails (kept current with Cursor CLI catalogs). */
export const CURSOR_FALLBACK_MODELS: readonly CursorDiscoveredModel[] = [
  { id: 'composer-2.5', displayName: 'Composer 2.5', maxContextSize: 200_000, capabilities: ['thinking', 'tool_use'] },
  { id: 'composer-2.5-fast', displayName: 'Composer 2.5 Fast', maxContextSize: 200_000, capabilities: ['thinking', 'tool_use'] },
  { id: 'claude-4.6-opus-high', displayName: 'Claude 4.6 Opus', maxContextSize: 200_000, capabilities: ['thinking', 'tool_use', 'image_in'] },
  { id: 'claude-4.6-sonnet', displayName: 'Claude 4.6 Sonnet', maxContextSize: 200_000, capabilities: ['thinking', 'tool_use', 'image_in'] },
  { id: 'claude-4.5-sonnet', displayName: 'Claude 4.5 Sonnet', maxContextSize: 200_000, capabilities: ['thinking', 'tool_use', 'image_in'] },
  { id: 'claude-sonnet-5-medium', displayName: 'Claude Sonnet 5', maxContextSize: 300_000, capabilities: ['thinking', 'tool_use', 'image_in'] },
  { id: 'claude-opus-4-8-medium', displayName: 'Claude Opus 4.8', maxContextSize: 300_000, capabilities: ['thinking', 'tool_use', 'image_in'] },
  { id: 'gpt-5.4-medium', displayName: 'GPT-5.4', maxContextSize: 272_000, capabilities: ['thinking', 'tool_use'] },
  { id: 'gpt-5.2', displayName: 'GPT-5.2', maxContextSize: 400_000, capabilities: ['thinking', 'tool_use'] },
  { id: 'gpt-5.2-codex', displayName: 'GPT-5.2 Codex', maxContextSize: 400_000, capabilities: ['thinking', 'tool_use'] },
  { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', maxContextSize: 272_000, capabilities: ['thinking', 'tool_use'] },
  { id: 'gemini-3.1-pro', displayName: 'Gemini 3.1 Pro', maxContextSize: 1_000_000, capabilities: ['thinking', 'tool_use', 'image_in'] },
  { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', maxContextSize: 1_000_000, capabilities: ['thinking', 'tool_use', 'image_in'] },
  { id: 'grok-4.5-fast-high', displayName: 'Grok 4.5 Fast', maxContextSize: 256_000, capabilities: ['thinking', 'tool_use'] },
  { id: 'grok-code-fast-1', displayName: 'Grok Code Fast 1', maxContextSize: 128_000, capabilities: ['tool_use'] },
  { id: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code', maxContextSize: 262_000, capabilities: ['thinking', 'tool_use'] },
  { id: 'glm-5.2-high', displayName: 'GLM 5.2 High', maxContextSize: 200_000, capabilities: ['thinking', 'tool_use'] },
];

export function cursorModelsToPresets(
  models: readonly CursorDiscoveredModel[],
): ProviderModelPreset[] {
  return models.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    maxContextSize: model.maxContextSize,
    capabilities: model.capabilities,
  }));
}

export const CURSOR_OAUTH_PROVIDER_ID = 'cursor-oauth';

/** Replace `cursor-oauth/*` aliases with a freshly discovered catalog. */
export function applyCursorOAuthModelAliases(
  config: {
    models?: Record<string, unknown> | undefined;
  },
  models: readonly CursorDiscoveredModel[],
): void {
  const nextModels: Record<string, unknown> = { ...(config.models ?? {}) };
  for (const key of Object.keys(nextModels)) {
    if (key.startsWith(`${CURSOR_OAUTH_PROVIDER_ID}/`)) delete nextModels[key];
  }
  for (const model of models) {
    nextModels[`${CURSOR_OAUTH_PROVIDER_ID}/${model.id}`] = {
      provider: CURSOR_OAUTH_PROVIDER_ID,
      model: model.id,
      maxContextSize: model.maxContextSize,
      capabilities: [...model.capabilities],
      displayName: model.displayName,
    };
  }
  config.models = nextModels;
}

export interface FetchCursorAvailableModelsOptions {
  readonly accessToken: string;
  readonly apiHost?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** When true, include max-named / nightlies (default false). */
  readonly includeMaxNamed?: boolean;
}

/**
 * Fetch the account's Cursor model catalog. Returns `undefined` on transport /
 * parse failure so callers can fall back to static presets.
 */
export async function fetchCursorAvailableModels(
  options: FetchCursorAvailableModelsOptions,
): Promise<CursorDiscoveredModel[] | undefined> {
  const token = options.accessToken.trim();
  if (token.length === 0) return undefined;
  const host = (options.apiHost ?? DEFAULT_API_HOST).replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let raw: unknown;
  try {
    raw = await postConnectJson(
      host,
      AVAILABLE_MODELS_PATH,
      {
        isNightly: false,
        excludeMaxNamedModels: options.includeMaxNamed !== true,
        additionalModelNames: [],
        useModelParameters: true,
        useReactModelPicker: true,
      },
      token,
      { timeoutMs, signal: options.signal },
    );
  } catch {
    return undefined;
  }

  if (!isRecord(raw)) return undefined;
  const modelsRaw = raw['models'];
  if (!Array.isArray(modelsRaw)) return undefined;
  const models = normalizeAvailableModels(modelsRaw);
  return models.length > 0 ? models : undefined;
}

/** Normalize AvailableModels JSON into picker entries (one per variant slug). */
export function normalizeAvailableModels(rawModels: readonly unknown[]): CursorDiscoveredModel[] {
  const byId = new Map<string, CursorDiscoveredModel>();
  const ranks = new Map<string, number>();

  for (const raw of rawModels) {
    if (!isRecord(raw)) continue;
    const name = stringProp(raw, 'name')?.trim();
    if (name === undefined || name.length === 0) continue;

    const supportsThinking = boolProp(raw, 'supportsThinking', true);
    const supportsImages = boolProp(raw, 'supportsImages', false);
    const capabilities = buildCapabilities(supportsThinking, supportsImages);
    const serverModelId = stringProp(raw, 'serverModelName')?.trim() || name;
    const variants = arrayProp(raw, 'variants');
    const variantRecords =
      variants.length > 0
        ? variants.filter(isRecord)
        : [
            {
              legacySlug: name,
              displayName:
                stringProp(raw, 'clientDisplayName') ??
                stringProp(raw, 'inputboxShortModelName') ??
                name,
              isDefaultNonMaxConfig: true,
              parameterValues: [],
            },
          ];

    variantRecords.forEach((variant, index) => {
      const publicId = (stringProp(variant, 'legacySlug') ?? name).trim();
      if (publicId.length === 0) return;
      const rank = rankVariant(variant, index);
      const existingRank = ranks.get(publicId);
      if (existingRank !== undefined && existingRank <= rank) return;

      const parameters = parseParameterValues(variant['parameterValues']);
      const context =
        contextFromParameters(parameters) ??
        contextFromText(stringProp(variant, 'tooltipData'), stringProp(raw, 'tooltipData')) ??
        DEFAULT_CONTEXT;
      const displayName = cleanDisplayName(
        stringProp(variant, 'displayNameOutsidePicker') ??
          stringProp(variant, 'displayName') ??
          stringProp(raw, 'clientDisplayName') ??
          stringProp(raw, 'inputboxShortModelName') ??
          publicId,
        parameters,
      );

      byId.set(publicId, {
        id: publicId,
        displayName,
        maxContextSize: context,
        capabilities,
        ...(serverModelId !== publicId ? { serverModelId } : {}),
      });
      ranks.set(publicId, rank);
    });
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function postConnectJson(
  baseUrl: string,
  path: string,
  body: unknown,
  accessToken: string,
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<unknown> {
  const url = new URL(baseUrl);
  const requestId = randomUUID();
  const payload = Buffer.from(JSON.stringify(body), 'utf8');

  return await new Promise((resolve, reject) => {
    const session = http2.connect(baseUrl);
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`Cursor AvailableModels timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      try {
        session.close();
      } catch {
        // ignore
      }
      if (error !== undefined) reject(error);
      else resolve(value);
    };

    const onAbort = (): void => {
      finish(new Error('Cursor AvailableModels aborted'));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    session.once('error', (error) => finish(error));
    session.once('connect', () => {
      const req = session.request({
        ':method': 'POST',
        ':path': path,
        ':authority': url.host,
        ':scheme': 'https',
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'connect-protocol-version': '1',
        accept: 'application/json',
        'user-agent': 'connect-es/1.6.1',
        'x-cursor-client-type': CURSOR_CLIENT_TYPE,
        'x-cursor-client-version': resolveCursorClientVersion(),
        'x-ghost-mode': 'false',
        'x-request-id': requestId,
        'content-length': payload.length,
      });
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on('error', (error) => finish(error));
      req.on('response', (headers) => {
        const status = headers[':status'];
        if (typeof status === 'number' && status >= 400) {
          finish(new Error(`Cursor AvailableModels failed (HTTP ${status})`));
        }
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        if (text.length === 0) {
          finish(new Error('Cursor AvailableModels returned empty body'));
          return;
        }
        try {
          // Connect JSON unary returns raw JSON; some gateways wrap a frame —
          // try JSON first, then strip a 5-byte Connect frame if needed.
          resolveJson(text, finish);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
      req.end(payload);
    });
  });
}

function resolveJson(
  text: string,
  finish: (error?: Error, value?: unknown) => void,
): void {
  try {
    finish(undefined, JSON.parse(text) as unknown);
    return;
  } catch {
    // fall through
  }
  const buf = Buffer.from(text, 'utf8');
  if (buf.length >= 5) {
    const len = buf.readUInt32BE(1);
    if (5 + len <= buf.length) {
      const inner = buf.subarray(5, 5 + len).toString('utf8');
      try {
        finish(undefined, JSON.parse(inner) as unknown);
        return;
      } catch {
        // fall through
      }
    }
  }
  finish(new Error('Cursor AvailableModels response was not JSON'));
}

function buildCapabilities(thinking: boolean, images: boolean): string[] {
  const caps = ['tool_use'];
  if (thinking) caps.unshift('thinking');
  if (images) caps.push('image_in');
  return caps;
}

function rankVariant(variant: Record<string, unknown>, index: number): number {
  if (boolProp(variant, 'isDefaultNonMaxConfig', false)) return index;
  if (boolProp(variant, 'isDefaultMaxConfig', false)) return 100_000 + index;
  return 200_000 + index;
}

function parseParameterValues(raw: unknown): Array<{ id: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; value: string }> = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = stringProp(item, 'id');
    const value = parameterToString(item['value']);
    if (id !== undefined && value !== undefined) out.push({ id, value });
  }
  return out;
}

function parameterToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function contextFromParameters(
  parameters: ReadonlyArray<{ id: string; value: string }>,
): number | undefined {
  const context = parameters.find((p) => p.id === 'context');
  return context ? parseTokenLimit(context.value) : undefined;
}

function contextFromText(...values: Array<string | undefined>): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (value === undefined) continue;
    for (const match of value.matchAll(/\b(\d+(?:\.\d+)?)\s*([kKmM])\s+context window\b/g)) {
      const parsed = parseTokenLimit(`${match[1]}${match[2]}`);
      if (parsed !== undefined && (best === undefined || parsed > best)) best = parsed;
    }
  }
  return best;
}

function parseTokenLimit(raw: string): number | undefined {
  const trimmed = raw.trim();
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(trimmed);
  if (match === null) {
    const asInt = Number.parseInt(trimmed, 10);
    return Number.isFinite(asInt) && asInt > 0 ? asInt : undefined;
  }
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = match[2]?.toLowerCase();
  if (unit === 'k') return Math.round(n * 1_000);
  if (unit === 'm') return Math.round(n * 1_000_000);
  return Math.round(n);
}

function cleanDisplayName(
  value: string,
  parameters: ReadonlyArray<{ id: string; value: string }>,
): string {
  let cleaned = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/:icon-[a-z-]+:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fast = parameters.some((p) => p.id === 'fast' && p.value === 'true');
  if (fast && !/\bfast\b/i.test(cleaned)) cleaned = `${cleaned} Fast`;
  return cleaned.length > 0 ? cleaned : value;
}

function stringProp(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function boolProp(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function arrayProp(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}
