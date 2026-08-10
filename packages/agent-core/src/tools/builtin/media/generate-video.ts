/**
 * GenerateVideoTool — text/image-to-video via provider keys on the machine.
 *
 * Zero-config with QWEN_TOKEN_PLAN_API_KEY / ALIBABA_TOKEN_PLAN_API_KEY
 * (same Token Plan service; happyhorse models, async task) or
 * GOOGLE_API_KEY/GEMINI_API_KEY (Gemini omni-flash).
 *
 * Qwen Cloud Token Plan: supports text-to-video (happyhorse-1.1-t2v),
 * image-to-video (happyhorse-1.1-i2v), and reference-to-video
 * (happyhorse-1.1-r2v) via an async task submission + polling pattern.
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
import { tokenPlanTaskApiUrl, tokenPlanVideoApiUrl } from './token-plan-endpoints';

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
    .describe('Optional first-frame image path for image-to-video (workspace-relative or absolute).'),
  reference_image_paths: z
    .array(z.string())
    .min(1)
    .max(9)
    .optional()
    .describe('Optional reference image paths (1–9) for reference-to-video (Qwen Cloud only).'),
  aspect_ratio: z
    .enum(['16:9', '9:16'])
    .optional()
    .describe('Aspect ratio when supported (ignored for image-to-video). Defaults to 16:9.'),
  duration_seconds: z
    .number()
    .int()
    .min(3)
    .max(15)
    .optional()
    .describe('Clip length in seconds when the provider supports it (3–15). Defaults to 5.'),
  resolution: z
    .enum(['720P', '1080P'])
    .optional()
    .describe('Output resolution (Qwen Cloud only). Defaults to 720P.'),
  provider: z
    .enum(['auto', 'xai', 'google', 'qwen'])
    .optional()
    .describe(
      'Prefer auto. Force only a ready backend (xai → qwen → google). Unavailable force falls back to auto — do not guess qwen/google.',
    ),
});

export type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;

export interface GenerateVideoProviderEnv {
  readonly googleApiKey?: string;
  readonly qwenTokenPlanApiKey?: string;
  /** Chat base URL used to derive the regional video / task API host. */
  readonly qwenTokenPlanBaseUrl?: string;
  readonly xaiApiKey?: string;
  readonly xaiGrokBuild?: import('../../providers/xai-grok-build').XaiGrokBuildClient;
  /** Extras services switched off in Settings — their env-key fallbacks are skipped. */
  readonly extrasDisabled?: readonly string[];
  readonly fetchImpl?: typeof fetch;
}

export type VideoGenerationProvider = 'xai' | 'google' | 'qwen';

function extrasAllows(env: GenerateVideoProviderEnv, id: string): boolean {
  return !(env.extrasDisabled ?? []).includes(id);
}

/** Ready backends in auto-route priority (xai → qwen → google). */
export function listReadyVideoGenerationProviders(
  env: GenerateVideoProviderEnv = {},
): VideoGenerationProvider[] {
  const ready: VideoGenerationProvider[] = [];
  const xaiEnv = extrasAllows(env, 'xai-grok') ? process.env['XAI_API_KEY'] : undefined;
  if (env.xaiGrokBuild !== undefined || nonEmpty(env.xaiApiKey ?? xaiEnv) !== undefined) {
    ready.push('xai');
  }
  if (
    nonEmpty(
      env.qwenTokenPlanApiKey ??
        (extrasAllows(env, 'qwen-token-plan')
          ? process.env['QWEN_TOKEN_PLAN_API_KEY'] ?? process.env['ALIBABA_TOKEN_PLAN_API_KEY']
          : undefined),
    ) !== undefined
  ) {
    ready.push('qwen');
  }
  if (
    nonEmpty(env.googleApiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY']) !==
    undefined
  ) {
    ready.push('google');
  }
  return ready;
}

export interface VideoProviderSelection {
  readonly provider: VideoGenerationProvider | undefined;
  readonly fellBackFrom?: VideoGenerationProvider;
}

/** Forced ids that are not ready fall back to auto (same contract as GenerateImage). */
export function selectVideoGenerationProvider(
  preferred: 'auto' | VideoGenerationProvider | undefined,
  env: GenerateVideoProviderEnv = {},
): VideoProviderSelection {
  const ready = listReadyVideoGenerationProviders(env);
  if (ready.length === 0) {
    return {
      provider: undefined,
      ...(preferred !== undefined && preferred !== 'auto' ? { fellBackFrom: preferred } : {}),
    };
  }
  if (preferred === undefined || preferred === 'auto') {
    return { provider: ready[0] };
  }
  if (ready.includes(preferred)) return { provider: preferred };
  return { provider: ready[0], fellBackFrom: preferred };
}

export function isGenerateVideoAvailable(env: GenerateVideoProviderEnv = {}): boolean {
  return listReadyVideoGenerationProviders(env).length > 0;
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
    const selection = selectVideoGenerationProvider(args.provider ?? 'auto', this.env);
    const provider = selection.provider;
    if (provider === undefined) {
      const requested =
        selection.fellBackFrom !== undefined
          ? ` Requested provider=${selection.fellBackFrom} is not ready.`
          : '';
      return {
        isError: true,
        output:
          `No video-generation provider found.${requested} Sign in with xAI Grok (/login), or set XAI_API_KEY / QWEN_TOKEN_PLAN_API_KEY / GOOGLE_API_KEY, then retry. Check readiness with /status.`,
      };
    }

    const parentError = await this.ensureParentDirectory(safePath);
    if (parentError !== undefined) {
      return { isError: true, output: parentError };
    }

    try {
      const generated =
        provider === 'xai'
          ? await generateWithXaiVideo(args, this.kaos, this.workspace, this.env)
          : provider === 'qwen'
            ? await generateWithQwenVideo(args, this.kaos, this.workspace, this.env)
            : await generateWithGeminiOmni(args, this.kaos, this.workspace, this.env);
      await this.kaos.writeBytes(safePath, generated.bytes);
      const label =
        provider === 'xai'
          ? 'xai'
          : provider === 'qwen'
            ? 'qwen (happyhorse)'
            : 'google (gemini-omni-flash-preview)';
      return {
        output: [
          `Generated video with ${label}.`,
          selection.fellBackFrom !== undefined
            ? `Note: provider=${selection.fellBackFrom} was not ready; fell back to auto → ${provider}. Prefer provider=auto next time.`
            : undefined,
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

// ── Qwen Cloud Token Plan video generation (async task) ────────────────

const QWEN_VIDEO_POLL_INTERVAL_MS = 15_000;
const QWEN_VIDEO_MAX_POLL_ATTEMPTS = 40; // 10 minutes max

async function generateWithXaiVideo(
  args: GenerateVideoInput,
  kaos: Kaos,
  workspace: WorkspaceConfig,
  env: GenerateVideoProviderEnv,
): Promise<GeneratedVideo> {
  const { createXaiGrokBuildClientFromEnv } = await import('../../providers/xai-grok-build');
  const client =
    env.xaiGrokBuild ??
    createXaiGrokBuildClientFromEnv({
      apiKey: env.xaiApiKey,
      fetchImpl: env.fetchImpl,
    });
  if (client === undefined) {
    throw new Error('xAI Grok credentials are not available for video generation.');
  }

  let imageUrl: string | undefined;
  if (args.image_path !== undefined && args.image_path.trim().length > 0) {
    imageUrl = await readWorkspaceImageAsDataUrl(args.image_path, kaos, workspace);
  }
  const referenceImageUrls: string[] = [];
  if (args.reference_image_paths !== undefined) {
    for (const ref of args.reference_image_paths.slice(0, 7)) {
      referenceImageUrls.push(await readWorkspaceImageAsDataUrl(ref, kaos, workspace));
    }
  }

  const result = await client.generateVideo({
    prompt: args.prompt,
    durationSeconds: args.duration_seconds,
    aspectRatio: args.aspect_ratio,
    resolution: args.resolution === '1080P' ? '720p' : args.resolution === '720P' ? '720p' : '480p',
    imageUrl,
    referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
    quality: false,
  });
  return {
    bytes: result.bytes,
    mimeType: result.mimeType,
    model: result.model,
  };
}

async function readWorkspaceImageAsDataUrl(
  imagePath: string,
  kaos: Kaos,
  workspace: WorkspaceConfig,
): Promise<string> {
  const resolved = resolvePathAccessPath(imagePath, {
    kaos,
    workspace,
    operation: 'read',
  });
  const bytes = await kaos.readBytes(resolved);
  const lower = imagePath.toLowerCase();
  const mime =
    lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg';
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

async function generateWithQwenVideo(
  args: GenerateVideoInput,
  kaos: Kaos,
  workspace: WorkspaceConfig,
  env: GenerateVideoProviderEnv,
): Promise<GeneratedVideo> {
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
  const videoApiUrl = tokenPlanVideoApiUrl(env.qwenTokenPlanBaseUrl);
  const taskApiUrl = tokenPlanTaskApiUrl(env.qwenTokenPlanBaseUrl);

  // Select mode: reference images → r2v, first frame → i2v, otherwise t2v.
  const hasReferenceImages =
    args.reference_image_paths !== undefined && args.reference_image_paths.length > 0;
  const hasFirstFrame = args.image_path !== undefined && args.image_path.trim().length > 0;
  const mode: 'r2v' | 'i2v' | 't2v' = hasReferenceImages ? 'r2v' : hasFirstFrame ? 'i2v' : 't2v';
  const model =
    mode === 'r2v'
      ? 'happyhorse-1.1-r2v'
      : mode === 'i2v'
        ? 'happyhorse-1.1-i2v'
        : 'happyhorse-1.1-t2v';

  // Build input payload.
  const input: Record<string, unknown> = { prompt: args.prompt };
  if (mode === 'r2v') {
    // r2v accepts 1–9 reference images as media entries.
    input['media'] = await Promise.all(
      args.reference_image_paths!.map(async (rawPath) => {
        const refPath = resolvePathAccessPath(rawPath.trim(), {
          kaos,
          workspace,
          operation: 'read',
        });
        const bytes = await kaos.readBytes(refPath);
        const mime = sniffImageMime(bytes);
        const b64 = Buffer.from(bytes).toString('base64');
        return { type: 'reference_image', url: `data:${mime};base64,${b64}` };
      }),
    );
  } else if (mode === 'i2v') {
    const imagePath = resolvePathAccessPath(args.image_path!.trim(), {
      kaos,
      workspace,
      operation: 'read',
    });
    const bytes = await kaos.readBytes(imagePath);
    // Qwen i2v expects the first frame as a media entry (URL or data URI).
    const mime = sniffImageMime(bytes);
    const b64 = Buffer.from(bytes).toString('base64');
    input['media'] = [{ type: 'first_frame', url: `data:${mime};base64,${b64}` }];
  }

  // `ratio` applies to t2v and r2v only; i2v derives it from the first frame.
  const parameters: Record<string, unknown> = {
    resolution: args.resolution ?? '720P',
    duration: args.duration_seconds ?? 5,
  };
  if (mode !== 'i2v') {
    parameters['ratio'] = args.aspect_ratio ?? '16:9';
  }

  // Submit async task.
  const submitResponse = await fetchImpl(videoApiUrl, {
    method: 'POST',
    headers: {
      'X-DashScope-Async': 'enable',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input,
      parameters,
    }),
  });

  if (!submitResponse.ok) {
    throw new Error(
      `Qwen video submission failed (${String(submitResponse.status)}): ${await submitResponse.text()}`,
    );
  }

  const submitPayload = (await submitResponse.json()) as {
    output?: { task_id?: string; task_status?: string };
  };
  const taskId = submitPayload.output?.task_id;
  if (taskId === undefined || taskId.length === 0) {
    throw new Error('Qwen video generation returned no task_id.');
  }

  // Poll task status.
  let videoUrl: string | undefined;
  for (let attempt = 0; attempt < QWEN_VIDEO_MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(QWEN_VIDEO_POLL_INTERVAL_MS);
    const pollResponse = await fetchImpl(`${taskApiUrl}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollResponse.ok) {
      throw new Error(`Qwen task poll failed (${String(pollResponse.status)}): ${await pollResponse.text()}`);
    }
    const pollPayload = (await pollResponse.json()) as {
      output?: {
        task_status?: string;
        video_url?: string;
        message?: string;
      };
    };
    const status = pollPayload.output?.task_status;
    if (status === 'SUCCEEDED') {
      videoUrl = pollPayload.output?.video_url;
      break;
    }
    if (status === 'FAILED') {
      throw new Error(
        `Qwen video generation failed: ${pollPayload.output?.message ?? 'unknown error'}`,
      );
    }
    // PENDING / RUNNING — continue polling.
  }

  if (videoUrl === undefined || videoUrl.length === 0) {
    throw new Error('Qwen video generation timed out waiting for task completion.');
  }

  // Download the video.
  const videoResponse = await fetchImpl(videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download Qwen video (${String(videoResponse.status)})`);
  }
  const arrayBuffer = await videoResponse.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    mimeType: videoResponse.headers.get('content-type') ?? 'video/mp4',
    model,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Google Gemini video generation ─────────────────────────────────────

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
