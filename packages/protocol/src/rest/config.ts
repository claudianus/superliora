import { z } from 'zod';

export const providerConfigResponseSchema = z.object({
  type: z.string(),
  base_url: z.string().optional(),
  default_model: z.string().optional(),
  has_api_key: z.boolean(),
});
export type ProviderConfigResponse = z.infer<typeof providerConfigResponseSchema>;

export const configResponseSchema = z.object({
  providers: z.record(z.string(), providerConfigResponseSchema).default({}),
  default_provider: z.string().optional(),
  default_model: z.string().optional(),
  models: z.record(z.string(), z.unknown()).optional(),
  thinking: z.unknown().optional(),
  yolo: z.boolean().optional(),
  default_thinking: z.boolean().optional(),
  default_permission_mode: z.string().optional(),
  sandbox_profile: z.string().optional(),
  sandbox_enforcement: z.string().optional(),
  permission: z.unknown().optional(),
  loop_control: z.unknown().optional(),
  background: z.unknown().optional(),
  cache: z.unknown().optional(),
  model_catalog: z.unknown().optional(),
  telemetry: z.boolean().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;

export const patchConfigRequestSchema = z.strictObject({
  providers: z.record(z.string(), z.unknown()).optional(),
  default_provider: z.string().optional(),
  default_model: z.string().optional(),
  models: z.record(z.string(), z.unknown()).optional(),
  thinking: z.unknown().optional(),
  yolo: z.boolean().optional(),
  default_thinking: z.boolean().optional(),
  default_permission_mode: z.string().optional(),
  sandbox_profile: z.string().optional(),
  sandbox_enforcement: z.string().optional(),
  permission: z.unknown().optional(),
  loop_control: z.unknown().optional(),
  background: z.unknown().optional(),
  cache: z.unknown().optional(),
  model_catalog: z.unknown().optional(),
  telemetry: z.boolean().optional(),
});
export type PatchConfigRequest = z.infer<typeof patchConfigRequestSchema>;
