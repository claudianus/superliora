import { z } from 'zod';

export const ToolInputDisplaySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('command'),
    command: z.string(),
    cwd: z.string().optional(),
    description: z.string().optional(),
    language: z.literal('bash').optional(),
  }),
  z.object({
    kind: z.literal('generic'),
    summary: z.string(),
    detail: z.unknown().optional(),
  }),
]);

export const ToolResultDisplaySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('command_output'),
    exit_code: z.number().nullable(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  }),
  z.object({
    kind: z.literal('background_task'),
    task_id: z.string(),
    status: z.string(),
    description: z.string(),
  }),
  z.object({ kind: z.literal('structured'), data: z.unknown() }),
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    truncated: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
  }),
  z.object({
    kind: z.literal('generic'),
    summary: z.string(),
    detail: z.unknown().optional(),
  }),
]);

export type ToolInputDisplay = z.infer<typeof ToolInputDisplaySchema>;
export type ToolResultDisplay = z.infer<typeof ToolResultDisplaySchema>;
