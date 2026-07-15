/**
 * GenerateImageTool — text-to-image via provider keys already on the machine.
 *
 * Zero-config for beginners: if OPENAI_API_KEY or GOOGLE_API_KEY/GEMINI_API_KEY
 * is set, the tool is registered. No MCP or skill catalog required.
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
    .enum(['auto', 'openai', 'google'])
    .optional()
    .describe('Force a provider. Default auto picks the first available key.'),
});

export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

export interface GenerateImageProviderEnv {
  readonly openaiApiKey?: string;
  readonly googleApiKey?: string;
  readonly fetchImpl?: typeof fetch;
}

export function resolveImageGenerationProvider(
  preferred: 'auto' | 'openai' | 'google' | undefined,
  env: GenerateImageProviderEnv = {},
): 'openai' | 'google' | undefined {
  const openai = nonEmpty(env.openaiApiKey ?? process.env['OPENAI_API_KEY']);
  const google = nonEmpty(env.googleApiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY']);
  if (preferred === 'openai') return openai !== undefined ? 'openai' : undefined;
  if (preferred === 'google') return google !== undefined ? 'google' : undefined;
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
          'No image-generation provider key found. Set OPENAI_API_KEY, or GOOGLE_API_KEY / GEMINI_API_KEY (no MCP setup), then retry. Check readiness with /status.',
      };
    }

    const parentError = await this.ensureParentDirectory(safePath);
    if (parentError !== undefined) {
      return { isError: true, output: parentError };
    }

    try {
      const generated =
        provider === 'openai'
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
