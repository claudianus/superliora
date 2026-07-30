import { z } from 'zod';

import { configResponseSchema, type ConfigResponse } from '../rest/config';
import {
  providerRefreshChangeSchema,
  providerRefreshFailureSchema,
  type ProviderRefreshChange,
  type ProviderRefreshFailure,
} from '../modelCatalog';
import { sessionSchema, sessionStatusSchema, type Session, type SessionStatus } from '../session';
import { workspaceSchema, type Workspace } from '../workspace';

export interface SessionMetaUpdatedEvent {
  readonly type: 'session.meta.updated';
  readonly title?: string;
  readonly patch?: Record<string, unknown>;
}

export interface SessionCreatedEvent {
  readonly type: 'event.session.created';
  readonly session: Session;
}

export interface WorkspaceCreatedEvent {
  readonly type: 'event.workspace.created';
  readonly workspace: Workspace;
}

export interface WorkspaceUpdatedEvent {
  readonly type: 'event.workspace.updated';
  readonly workspace: Workspace;
}

export interface WorkspaceDeletedEvent {
  readonly type: 'event.workspace.deleted';
  readonly workspace_id: string;
  readonly root: string;
}

export interface SessionStatusChangedEvent {
  readonly type: 'event.session.status_changed';
  readonly status: SessionStatus;
  readonly previous_status: SessionStatus;
  readonly current_prompt_id?: string;
}

export interface ConfigChangedEvent {
  readonly type: 'event.config.changed';
  readonly changedFields: string[];
  readonly config: ConfigResponse;
}

export interface ModelCatalogChangedEvent {
  readonly type: 'event.model_catalog.changed';
  readonly changed: readonly ProviderRefreshChange[];
  readonly unchanged: readonly string[];
  readonly failed: readonly ProviderRefreshFailure[];
}

export const sessionMetaUpdatedEventSchema = z.object({
  type: z.literal('session.meta.updated'),
  title: z.string().optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<SessionMetaUpdatedEvent>;

export const sessionCreatedEventSchema = z.object({
  type: z.literal('event.session.created'),
  session: sessionSchema,
}) satisfies z.ZodType<SessionCreatedEvent>;

export const workspaceCreatedEventSchema = z.object({
  type: z.literal('event.workspace.created'),
  workspace: workspaceSchema,
}) satisfies z.ZodType<WorkspaceCreatedEvent>;

export const workspaceUpdatedEventSchema = z.object({
  type: z.literal('event.workspace.updated'),
  workspace: workspaceSchema,
}) satisfies z.ZodType<WorkspaceUpdatedEvent>;

export const workspaceDeletedEventSchema = z.object({
  type: z.literal('event.workspace.deleted'),
  workspace_id: z.string().min(1),
  root: z.string().min(1),
}) satisfies z.ZodType<WorkspaceDeletedEvent>;

export const sessionStatusChangedEventSchema = z.object({
  type: z.literal('event.session.status_changed'),
  status: sessionStatusSchema,
  previous_status: sessionStatusSchema,
  current_prompt_id: z.string().min(1).optional(),
}) satisfies z.ZodType<SessionStatusChangedEvent>;

export const configChangedEventSchema = z.object({
  type: z.literal('event.config.changed'),
  changedFields: z.array(z.string()),
  config: configResponseSchema,
}) satisfies z.ZodType<ConfigChangedEvent>;

export const modelCatalogChangedEventSchema = z.object({
  type: z.literal('event.model_catalog.changed'),
  changed: z.array(providerRefreshChangeSchema),
  unchanged: z.array(z.string().min(1)),
  failed: z.array(providerRefreshFailureSchema),
}) satisfies z.ZodType<ModelCatalogChangedEvent>;
