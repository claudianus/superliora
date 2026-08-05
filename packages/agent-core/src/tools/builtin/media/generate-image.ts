/**
 * GenerateImageTool — text-to-image via provider keys already on the machine.
 *
 * Zero-config for beginners: if QWEN_TOKEN_PLAN_API_KEY, OPENAI_API_KEY, or
 * GOOGLE_API_KEY/GEMINI_API_KEY is set, the tool is registered. No MCP or
 * skill catalog required.
 *
 * Qwen Cloud Token Plan support: uses the multimodal-generation API with
 * wan2.7-image (default), wan2.7-image-pro, or qwen-image-2.0/-pro models.
 * Keys are read from QWEN_TOKEN_PLAN_API_KEY or ALIBABA_TOKEN_PLAN_API_KEY
 * (the same service, see models.dev `alibaba-token-plan`).
 */

import type { Kaos } from '@superliora/kaos';
import { dirname, join } from 'pathe';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '../../support/rule-match';
import type { WorkspaceConfig } from '../../support/workspace';
import DESCRIPTION from './generate-image.md?raw';

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;

export const GenerateImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('Detailed image prompt. Include subject, composition, style, lighting, and constraints.'),
  path: z
    .string()
    .optional()
    .describe(
      'Output path for the image file. Relative paths resolve against the working directory. Defaults to `.superliora/generated/images/<timestamp>.png`.',
    ),
  size: z
    .enum(['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792'])
    .optional()
    .describe('Output size when the selected provider supports it. Defaults to 1024x1024.'),
  provider: z
    .enum(['auto', 'xai', 'openai', 'google', 'qwen', 'codex'])
    .optional()
    .describe(
      'Force a provider. Default auto picks the first available (xai Grok Build → qwen → codex → openai → google).',
    ),
  model: z
    .enum(['wan2.7-image', 'wan2.7-image-pro', 'qwen-image-2.0', 'qwen-image-2.0-pro'])
    .optional()
    .describe('Qwen image model (qwen provider only). Defaults to wan2.7-image.'),
  aspect_ratio: z
    .enum(['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', 'auto'])
    .optional()
    .describe('Aspect ratio for xAI Imagine (xai provider). Defaults to auto.'),
});

export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

export interface GenerateImageProviderEnv {
  readonly openaiApiKey?: string;
  readonly googleApiKey?: string;
  readonly qwenTokenPlanApiKey?: string;
  readonly xaiApiKey?: string;
  readonly xaiGrokBuild?: import('../../providers/xai-grok-build').XaiGrokBuildClient;
  /** OpenAI Codex (ChatGPT subscription) extras credentials. */
  readonly codex?: import('../../providers/codex-extras').CodexExtrasOptions;
  /** Extras services switched off in Settings — their env-key fallbacks are skipped. */
  readonly extrasDisabled?: readonly string[];
  readonly fetchImpl?: typeof fetch;
}

export type ImageGenerationProvider = 'xai' | 'openai' | 'google' | 'qwen' | 'codex';

function extrasAllows(env: GenerateImageProviderEnv, id: string): boolean {
  return !(env.extrasDisabled ?? []).includes(id);
}

export function resolveImageGenerationProvider(
  preferred: 'auto' | ImageGenerationProvider | undefined,
  env: GenerateImageProviderEnv = {},
): ImageGenerationProvider | undefined {
  const xaiEnv = extrasAllows(env, 'xai-grok') ? process.env['XAI_API_KEY'] : undefined;
  const xaiReady =
    env.xaiGrokBuild !== undefined || nonEmpty(env.xaiApiKey ?? xaiEnv) !== undefined;
  const qwen = nonEmpty(
    env.qwenTokenPlanApiKey ??
      (extrasAllows(env, 'qwen-token-plan')
        ? process.env['QWEN_TOKEN_PLAN_API_KEY'] ?? process.env['ALIBABA_TOKEN_PLAN_API_KEY']
        : undefined),
  );
  const codex = env.codex;
  const openai = nonEmpty(env.openaiApiKey ?? process.env['OPENAI_API_KEY']);
  const google = nonEmpty(
    env.googleApiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY'],
  );
  if (preferred === 'xai') return xaiReady ? 'xai' : undefined;
  if (preferred === 'qwen') return qwen !== undefined ? 'qwen' : undefined;
  if (preferred === 'codex') return codex !== undefined ? 'codex' : undefined;
  if (preferred === 'openai') return openai !== undefined ? 'openai' : undefined;
  if (preferred === 'google') return google !== undefined ? 'google' : undefined;
  // Auto priority: xAI Grok Build subscription → qwen → codex → openai → google
  if (xaiReady) return 'xai';
  if (qwen !== undefined) return 'qwen';
  if (codex !== undefined) return 'codex';
  if (openai !== undefined) return 'openai';
  if (google !== undefined) return 'google';
  return undefined;
}

export function isGenerateImageAvailable(env: GenerateImageProviderEnv = {}): boolean {
  return resolveImageGenerationProvider('auto', env) !== undefined;
}

export class GenerateImageTool implements BuiltinTool<GenerateImageInput> {
  readonly name = 'GenerateImage' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(GenerateImageInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly env: GenerateImageProviderEnv = {},
  ) {}

  resolveExecution(args: GenerateImageInput): ToolExecution {
    const outputPath = args.path?.trim().length
      ? args.path.trim()
      : defaultImagePath();
    const path = resolvePathAccessPath(outputPath, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'write',
    });
    return {
      accesses: ToolAccesses.writeFile(path),
      description: `Generating image: ${truncate(args.prompt, 48)}`,
      display: { kind: 'file_io', operation: 'write', path },
      approvalRule: literalRulePattern(this.name, path),
      matchesRule: (ruleArgs) =>
        matchesPathRuleSubject(ruleArgs, path, {
          cwd: this.workspace.workspaceDir,
          pathClass: this.kaos.pathClass(),
          homeDir: this.kaos.gethome(),
        }),
      execute: () => this.execution(args, path, outputPath),
    };
  }

  private async execution(
    args: GenerateImageInput,
    safePath: string,
    displayPath: string,
  ): Promise<ExecutableToolResult> {
    const provider = resolveImageGenerationProvider(args.provider ?? 'auto', this.env);
    if (provider === undefined) {
      return {
        isError: true,
        output:
          'No image-generation provider found. Sign in with xAI Grok or OpenAI Codex (/login), or set XAI_API_KEY / QWEN_TOKEN_PLAN_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY, then retry. Check readiness with /status.',
      };
    }

    const parentError = await this.ensureParentDirectory(safePath);
    if (parentError !== undefined) {
      return { isError: true, output: parentError };
    }

    try {
      const generated =
        provider === 'xai'
          ? await generateWithXai(args, this.env)
          : provider === 'qwen'
            ? await generateWithQwen(args, this.env)
            : provider === 'codex'
              ? await generateWithCodex(args, this.env)
              : provider === 'openai'
                ? await generateWithOpenAI(args, this.env)
                : await generateWithGoogle(args, this.env);
      await this.kaos.writeBytes(safePath, generated.bytes);
      return {
        output: [
          `Generated image with ${provider}.`,
          `Path: ${displayPath}`,
          `Bytes: ${String(generated.bytes.byteLength)}`,
          `MIME: ${generated.mimeType}`,
          generated.model !== undefined ? `Model: ${generated.model}` : undefined,
          'Next: open the file or call ReadMediaFile when the model supports image input.',
        ]
          .filter((line): line is string => line !== undefined)
          .join('\n'),
      };
    } catch (error) {
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async ensureParentDirectory(safePath: string): Promise<string | undefined> {
    const parent = dirname(safePath);
    try {
      const stat = await this.kaos.stat(parent);
      if ((stat.stMode & S_IFMT) !== S_IFDIR) {
        return `Parent path is not a directory: ${parent}.`;
      }
      return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          await this.kaos.mkdir(parent, { parents: true, existOk: true });
          return undefined;
        } catch (mkdirError) {
          return mkdirError instanceof Error ? mkdirError.message : String(mkdirError);
        }
      }
      return undefined;
    }
  }
}

interface GeneratedImage {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly model?: string;
}

// ── Qwen Cloud Token Plan image generation ─────────────────────────────

const QWEN_IMAGE_API_URL =
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

/** Maps the tool's size enum to Qwen's `size` parameter format (WxH → W*H). */
function toQwenImageSize(size: string | undefined): string {
  switch (size) {
    case '1024x1024': return '1024*1024';
    case '1536x1024': return '1536*1024';
    case '1024x1536': return '1024*1536';
    case '1792x1024': return '1792*1024';
    case '1024x1792': return '1024*1792';
    default: return '1024*1024';
  }
}

async function generateWithXai(
  args: GenerateImageInput,
  env: GenerateImageProviderEnv,
): Promise<GeneratedImage> {
  const { createXaiGrokBuildClientFromEnv } = await import('../../providers/xai-grok-build');
  const client =
    env.xaiGrokBuild ??
    createXaiGrokBuildClientFromEnv({
      apiKey: env.xaiApiKey,
      fetchImpl: env.fetchImpl,
    });
  if (client === undefined) {
    throw new Error('xAI Grok credentials are not available for image generation.');
  }
  const aspect =
    args.aspect_ratio ??
    (args.size === '1536x1024' || args.size === '1792x1024'
      ? '16:9'
      : args.size === '1024x1536' || args.size === '1024x1792'
        ? '9:16'
        : '1:1');
  const result = await client.generateImage({
    prompt: args.prompt,
    aspectRatio: aspect,
  });
  return {
    bytes: result.bytes,
    mimeType: result.mimeType,
    model: result.model,
  };
}

async function generateWithQwen(
  args: GenerateImageInput,
  env: GenerateImageProviderEnv,
): Promise<GeneratedImage> {
  const apiKey = nonEmpty(
    env.qwenTokenPlanApiKey ??
      (extrasAllows(env, 'qwen-token-plan')
        ? process.env['QWEN_TOKEN_PLAN_API_KEY'] ?? process.env['ALIBABA_TOKEN_PLAN_API_KEY']
        : undefined),
  );
  if (apiKey === undefined) {
    throw new Error('QWEN_TOKEN_PLAN_API_KEY / ALIBABA_TOKEN_PLAN_API_KEY is not set.');
  }
  const fetchImpl = env.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const model = args.model ?? 'wan2.7-image';
  const size = toQwenImageSize(args.size);

  const response = await fetchImpl(QWEN_IMAGE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: {
        messages: [{ role: 'user', content: [{ text: args.prompt }] }],
      },
      parameters: { size },
    }),
  });

  if (!response.ok) {
    throw new Error(`Qwen image generation failed (${String(response.status)}): ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    output?: {
      choices?: Array<{
        message?: {
          content?: Array<{ image?: string; text?: string }>;
        };
      }>;
    };
  };

  // Extract image URL from output.choices[*].message.content[*].image
  for (const choice of payload.output?.choices ?? []) {
    for (const part of choice.message?.content ?? []) {
      if (part.image !== undefined && part.image.length > 0) {
        const imageResponse = await fetchImpl(part.image);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download Qwen image (${String(imageResponse.status)})`);
        }
        const arrayBuffer = await imageResponse.arrayBuffer();
        return {
          bytes: Buffer.from(arrayBuffer),
          mimeType: imageResponse.headers.get('content-type') ?? 'image/png',
          model,
        };
      }
    }
  }

  throw new Error('Qwen image generation returned no image content.');
}

// ── OpenAI Codex (ChatGPT subscription) image generation ───────────────

async function generateWithCodex(
  args: GenerateImageInput,
  env: GenerateImageProviderEnv,
): Promise<GeneratedImage> {
  const codex = env.codex;
  if (codex === undefined) {
    throw new Error('OpenAI Codex (ChatGPT) session is not available for image generation.');
  }
  const { generateCodexImage } = await import('../../providers/codex-extras');
  try {
    const result = await generateCodexImage(
      {
        ...codex,
        ...(env.fetchImpl !== undefined ? { fetchImpl: env.fetchImpl } : {}),
      },
      { prompt: args.prompt, ...(args.size !== undefined ? { size: args.size } : {}) },
    );
    return { bytes: result.bytes, mimeType: result.mimeType, model: result.model };
  } catch (error) {
    // Subscription path failed (quota, backend gap) — fall back to the
    // platform OpenAI key when one is configured instead of erroring out.
    if (nonEmpty(env.openaiApiKey ?? process.env['OPENAI_API_KEY']) !== undefined) {
      return generateWithOpenAI(args, env);
    }
    throw error;
  }
}

// ── OpenAI image generation ────────────────────────────────────────────

async function generateWithOpenAI(
  args: GenerateImageInput,
  env: GenerateImageProviderEnv,
): Promise<GeneratedImage> {
  const apiKey = nonEmpty(env.openaiApiKey ?? process.env['OPENAI_API_KEY']);
  if (apiKey === undefined) throw new Error('OPENAI_API_KEY is not set.');
  const fetchImpl = env.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const size = args.size ?? '1024x1024';
  const models = ['gpt-image-1', 'dall-e-3'] as const;

  let lastError: string | undefined;
  for (const model of models) {
    try {
      const response = await fetchImpl('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt: args.prompt,
          size,
          n: 1,
          response_format: 'b64_json',
        }),
      });
      if (!response.ok) {
        lastError = `OpenAI ${model} failed (${String(response.status)}): ${await response.text()}`;
        continue;
      }
      const payload = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const item = payload.data?.[0];
      if (item?.b64_json !== undefined && item.b64_json.length > 0) {
        return {
          bytes: Buffer.from(item.b64_json, 'base64'),
          mimeType: 'image/png',
          model,
        };
      }
      if (item?.url !== undefined && item.url.length > 0) {
        const imageResponse = await fetchImpl(item.url);
        if (!imageResponse.ok) {
          lastError = `Failed to download OpenAI image URL (${String(imageResponse.status)})`;
          continue;
        }
        const arrayBuffer = await imageResponse.arrayBuffer();
        return {
          bytes: Buffer.from(arrayBuffer),
          mimeType: imageResponse.headers.get('content-type') ?? 'image/png',
          model,
        };
      }
      lastError = `OpenAI ${model} returned no image payload.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError ?? 'OpenAI image generation failed.');
}

async function generateWithGoogle(
  args: GenerateImageInput,
  env: GenerateImageProviderEnv,
): Promise<GeneratedImage> {
  const apiKey = nonEmpty(env.googleApiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY']);
  if (apiKey === undefined) throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY is not set.');
  const fetchImpl = env.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const model = 'gemini-2.0-flash-preview-image-generation';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Gemini image generation failed (${String(response.status)}): ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          inline_data?: { data?: string; mime_type?: string };
        }>;
      };
    }>;
  };
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData;
      const snake = part.inline_data;
      const data = inline?.data ?? snake?.data;
      if (data !== undefined && data.length > 0) {
        return {
          bytes: Buffer.from(data, 'base64'),
          mimeType: inline?.mimeType ?? snake?.mime_type ?? 'image/png',
          model,
        };
      }
    }
  }
  throw new Error('Gemini image generation returned no image parts.');
}

function defaultImagePath(): string {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  return join('.superliora', 'generated', 'images', `${stamp}.png`);
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
