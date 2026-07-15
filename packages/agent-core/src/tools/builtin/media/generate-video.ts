/**
 * GenerateVideoTool — text/image-to-video via Google Gemini when a key exists.
 *
 * Zero-config for beginners with GOOGLE_API_KEY or GEMINI_API_KEY. OpenAI
 * video APIs are intentionally out of scope until a stable public path exists.
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
import DESCRIPTION from './generate-video.md?raw';

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;

export const GenerateVideoInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('Detailed video prompt: subject, camera motion, lighting, duration intent, style.'),
  path: z
    .string()
    .optional()
    .describe(
      'Output path for the video file. Defaults to `.superliora/generated/videos/<timestamp>.mp4`.',
    ),
  image_path: z
    .string()
    .optional()
    .describe('Optional first-frame / reference image path (workspace-relative or absolute).'),
  aspect_ratio: z
    .enum(['16:9', '9:16'])
    .optional()
    .describe('Aspect ratio when supported. Defaults to 16:9.'),
  duration_seconds: z
    .number()
    .int()
    .min(3)
    .max(10)
    .optional()
    .describe('Clip length in seconds when the provider supports it (3–10). Defaults to 5.'),
});

export type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;

export interface GenerateVideoProviderEnv {
  readonly googleApiKey?: string;
  readonly fetchImpl?: typeof fetch;
}

export function isGenerateVideoAvailable(env: GenerateVideoProviderEnv = {}): boolean {
  return nonEmpty(env.googleApiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY']) !== undefined;
}

export class GenerateVideoTool implements BuiltinTool<GenerateVideoInput> {
  readonly name = 'GenerateVideo' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(GenerateVideoInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly env: GenerateVideoProviderEnv = {},
  ) {}

  resolveExecution(args: GenerateVideoInput): ToolExecution {
    const outputPath = args.path?.trim().length ? args.path.trim() : defaultVideoPath();
    const path = resolvePathAccessPath(outputPath, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'write',
    });
    return {
      accesses: ToolAccesses.writeFile(path),
      description: `Generating video: ${truncate(args.prompt, 48)}`,
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
    args: GenerateVideoInput,
    safePath: string,
    displayPath: string,
  ): Promise<ExecutableToolResult> {
    if (!isGenerateVideoAvailable(this.env)) {
      return {
        isError: true,
        output:
          'No video-generation provider key found. Set GOOGLE_API_KEY or GEMINI_API_KEY, then retry. Alternatively SearchSkill → gemini-omni-flash-api.',
      };
    }

    const parentError = await this.ensureParentDirectory(safePath);
    if (parentError !== undefined) {
      return { isError: true, output: parentError };
    }

    try {
      const generated = await generateWithGeminiOmni(args, this.kaos, this.workspace, this.env);
      await this.kaos.writeBytes(safePath, generated.bytes);
      return {
        output: [
          'Generated video with google (gemini-omni-flash-preview).',
          `Path: ${displayPath}`,
          `Bytes: ${String(generated.bytes.byteLength)}`,
          `MIME: ${generated.mimeType}`,
          generated.model !== undefined ? `Model: ${generated.model}` : undefined,
          'Next: open the file or call ReadMediaFile when the model supports video input.',
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

interface GeneratedVideo {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly model?: string;
}

async function generateWithGeminiOmni(
  args: GenerateVideoInput,
  kaos: Kaos,
  workspace: WorkspaceConfig,
  env: GenerateVideoProviderEnv,
): Promise<GeneratedVideo> {
  const apiKey = nonEmpty(env.googleApiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY']);
  if (apiKey === undefined) throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY is not set.');
  const fetchImpl = env.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const model = 'gemini-omni-flash-preview';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts: Array<Record<string, unknown>> = [{ text: args.prompt }];
  if (args.image_path !== undefined && args.image_path.trim().length > 0) {
    const imagePath = resolvePathAccessPath(args.image_path.trim(), {
      kaos,
      workspace,
      operation: 'read',
    });
    const bytes = await kaos.readBytes(imagePath);
    parts.push({
      inlineData: {
        mimeType: sniffImageMime(bytes),
        data: Buffer.from(bytes).toString('base64'),
      },
    });
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'VIDEO'],
        // Best-effort hints; providers may ignore unknown fields.
        aspectRatio: args.aspect_ratio ?? '16:9',
        durationSeconds: args.duration_seconds ?? 5,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Gemini video generation failed (${String(response.status)}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          inline_data?: { data?: string; mime_type?: string };
          fileData?: { fileUri?: string; mimeType?: string };
          file_data?: { file_uri?: string; mime_type?: string };
        }>;
      };
    }>;
  };

  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData;
      const snakeInline = part.inline_data;
      const data = inline?.data ?? snakeInline?.data;
      if (data !== undefined && data.length > 0) {
        return {
          bytes: Buffer.from(data, 'base64'),
          mimeType: inline?.mimeType ?? snakeInline?.mime_type ?? 'video/mp4',
          model,
        };
      }
      const file = part.fileData;
      const snakeFile = part.file_data;
      const fileUri = file?.fileUri ?? snakeFile?.file_uri;
      if (fileUri !== undefined && fileUri.length > 0) {
        const videoResponse = await fetchImpl(fileUri);
        if (!videoResponse.ok) {
          throw new Error(`Failed to download Gemini video URI (${String(videoResponse.status)})`);
        }
        const arrayBuffer = await videoResponse.arrayBuffer();
        return {
          bytes: Buffer.from(arrayBuffer),
          mimeType:
            file?.mimeType ??
            snakeFile?.mime_type ??
            videoResponse.headers.get('content-type') ??
            'video/mp4',
          model,
        };
      }
    }
  }

  throw new Error(
    'Gemini video generation returned no video parts. The model or region may not support this request yet; try SearchSkill → gemini-omni-flash-api.',
  );
}

function defaultVideoPath(): string {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  return join('.superliora', 'generated', 'videos', `${stamp}.mp4`);
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return 'image/webp';
  }
  return 'image/png';
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
