import type { OAuthTokenProviderResolver } from '../session/provider-manager';
import type { TelemetryClient } from '../telemetry';
import type { ToolServices } from '../tools/support/services';
import type { RenameSessionPayload, UpdateSessionMetadataPayload } from './core-api';

type AgentScopedPayload<T> = T & { readonly agentId: string };
type SessionScopedPayload<T> = T & { readonly sessionId: string };

export type SessionAgentPayload<T> = SessionScopedPayload<AgentScopedPayload<T>>;
export type RenameSessionRequest = SessionScopedPayload<RenameSessionPayload>;
export type UpdateSessionMetadataRequest = SessionScopedPayload<UpdateSessionMetadataPayload>;

export interface LioraCoreOptions {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
  readonly runtime?: ToolServices | undefined;
  readonly kimiRequestHeaders?: Record<string, string> | undefined;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver | undefined;
  readonly skillDirs?: readonly string[];
  readonly telemetry?: TelemetryClient | undefined;
  readonly appVersion?: string;
}
