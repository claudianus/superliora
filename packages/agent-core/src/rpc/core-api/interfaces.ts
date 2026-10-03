import type { AgentConfigData } from '#/agent/config';
import type { AgentContextData, ContextComposition } from '#/agent/context';
import type { BackgroundTaskInfo } from '#/agent/background';
import type { PermissionData } from '#/agent/permission';
import type { CircuitBreakerStatus, SessionWarning } from '@superliora/protocol';
import type { LioraConfig } from '#/config';
import type { ResumeSessionResult } from '#/rpc/resumed';
import type { SessionMeta } from '#/session';
import type { ProviderRouteStatus, UsageStatus } from '../events';
import type { WithAgentId, WithSessionId } from '../types';
import type { SessionTrace } from './session-trace';
import type {
  AddAdditionalDirPayload, AddAdditionalDirResult, ArchiveSessionPayload, CloseSessionPayload,
  ConversationLoopStateData, CoreInfo, CreateSessionPayload, EmptyPayload, ExportSessionPayload,
  ExportSessionResult, ForkSessionPayload, ListSessionsPayload, ReloadSessionPayload,
  RenameSessionPayload, ResumeSessionPayload, RewindFilesPayload, RewindFilesResult,
  SessionSummary, StartConversationLoopPayload, StopConversationLoopPayload, UpdateSessionMetadataPayload,
} from './payloads-session';
import type {
  BeginCompactionPayload, CancelPayload, CancelShellCommandPayload, DetachBackgroundPayload,
  GetBackgroundOutputPayload, GetBackgroundPayload, PromptPayload, RunShellCommandPayload,
  SetModelPayload, SetModelResult, SetPermissionPayload, SetThinkingPayload, ShellCommandResult,
  SteerPayload, StopBackgroundPayload, UndoHistoryPayload,
} from './payloads-agent';
import type {
  JobActionResult, JobCancelPayload, JobCreateBatchPayload, JobCreatePayload, JobCreateResult,
  JobGcWorktreesPayload, JobGcWorktreesResult, JobInboxPayload, JobInboxResult, JobIdPayload,
  JobInspectResult, JobMergePayload, JobMergeResult, JobPushPayload, JobPushResult, JobPreviewSplitPayload,
  JobResumePayload, JobResumeResult, JobAdoptPayload, JobAdoptResult, JobLandChoicePayload,
  JobRenamePayload, JobSetProjectModePayload, JobSetProjectModeResult, JobSnapshot,
  JobWorkspaceCatalogPayload, JobWorkspaceCatalogResult, JobSteerPayload, SplitJobIntent,
} from './payloads-job';
import type {
  ConfigDiagnostics, DeleteConfigFieldsPayload, GetKimiConfigPayload, RemoveKimiProviderPayload, SetKimiConfigPayload,
} from './payloads-config';

export interface AgentAPI {
  prompt: (payload: PromptPayload) => void;
  runShellCommand: (payload: RunShellCommandPayload) => Promise<ShellCommandResult>;
  cancelShellCommand: (payload: CancelShellCommandPayload) => void;
  steer: (payload: SteerPayload) => void;
  cancel: (payload: CancelPayload) => void;
  undoHistory: (payload: UndoHistoryPayload) => void;
  setThinking: (payload: SetThinkingPayload) => void;
  setPermission: (payload: SetPermissionPayload) => void;
  setModel: (payload: SetModelPayload) => SetModelResult;
  getModel: (payload: EmptyPayload) => string;
  beginCompaction: (payload: BeginCompactionPayload) => void;
  cancelCompaction: (payload: EmptyPayload) => void;
  stopBackground: (payload: StopBackgroundPayload) => Promise<void>;
  detachBackground: (payload: DetachBackgroundPayload) => BackgroundTaskInfo | undefined;
  clearContext: (payload: EmptyPayload) => void;
  jobList: (payload: EmptyPayload) => readonly JobSnapshot[];
  jobInspect: (payload: JobIdPayload) => JobInspectResult | undefined;
  jobInbox: (payload: JobInboxPayload) => JobInboxResult;
  jobSteer: (payload: JobSteerPayload) => Promise<JobActionResult>;
  jobCancel: (payload: JobCancelPayload) => Promise<JobActionResult>;
  jobPause: (payload: JobCancelPayload) => Promise<JobActionResult>;
  jobResume: (payload: JobResumePayload) => Promise<JobResumeResult>;
  jobCreate: (payload: JobCreatePayload) => Promise<JobCreateResult>;
  jobCreateBatch: (payload: JobCreateBatchPayload) => Promise<JobCreateResult>;
  jobMerge: (payload: JobMergePayload) => Promise<JobMergeResult>;
  jobPush: (payload: JobPushPayload) => Promise<JobPushResult>;
  jobPreviewSplit: (payload: JobPreviewSplitPayload) => readonly SplitJobIntent[];
  jobGcWorktrees: (payload: JobGcWorktreesPayload) => Promise<JobGcWorktreesResult>;
  jobSetProjectMode: (payload: JobSetProjectModePayload) => JobSetProjectModeResult;
  jobWorkspaceCatalog: (payload: JobWorkspaceCatalogPayload) => JobWorkspaceCatalogResult;
  jobAdoptWorkspace: (payload: JobAdoptPayload) => Promise<JobAdoptResult>;
  jobArchiveWorkspace: (payload: JobIdPayload) => JobActionResult;
  jobRenameWorkspace: (payload: JobRenamePayload) => JobActionResult;
  jobLandChoice: (payload: JobLandChoicePayload) => Promise<JobActionResult>;
  getBackgroundOutput: (payload: GetBackgroundOutputPayload) => string;
  getContext: (payload: EmptyPayload) => AgentContextData;
  getContextComposition: (payload: EmptyPayload) => ContextComposition;
  getConfig: (payload: EmptyPayload) => AgentConfigData;
  getPermission: (payload: EmptyPayload) => PermissionData;
  getCircuitBreakers: (payload: EmptyPayload) => CircuitBreakerStatus | undefined;
  getCacheFrozen: (payload: EmptyPayload) => boolean;
  getCacheFreezeViolations: (payload: EmptyPayload) => number;
  getParallelToolsStatus: (payload: EmptyPayload) => { readonly parallelToolsInFlight: number; readonly maxParallelTools?: number };
  getOAuthStatus: (payload: EmptyPayload) => Promise<{ readonly poolSize?: number; readonly nextRefreshAtMs?: number } | undefined>;
  getUsage: (payload: EmptyPayload) => UsageStatus;
  getProviderRouteStatus: (payload: EmptyPayload) => ProviderRouteStatus | null;
  resetProviderRouteStatus: (payload: EmptyPayload) => ProviderRouteStatus | null;
  getBackground: (payload: GetBackgroundPayload) => readonly BackgroundTaskInfo[];
}

export interface SessionAPI extends WithAgentId<AgentAPI> {
  renameSession: (payload: RenameSessionPayload) => void;
  updateSessionMetadata: (payload: UpdateSessionMetadataPayload) => void;
  getSessionMetadata: (payload: EmptyPayload) => SessionMeta;
  startBtw: (payload: EmptyPayload & { readonly agentId: string }) => string;
  getSessionWarnings: (payload: EmptyPayload) => readonly SessionWarning[];
  addAdditionalDir: (payload: AddAdditionalDirPayload) => AddAdditionalDirResult;
  getSessionTrace: (payload: EmptyPayload & { readonly agentId: string }) => Promise<SessionTrace>;
  rewindFiles: (payload: RewindFilesPayload) => RewindFilesResult;
  startConversationLoop: (payload: StartConversationLoopPayload) => ConversationLoopStateData;
  stopConversationLoop: (payload: StopConversationLoopPayload) => ConversationLoopStateData | undefined;
  listConversationLoops: (payload: EmptyPayload) => readonly ConversationLoopStateData[];
}

export interface CoreAPI extends WithSessionId<SessionAPI> {
  getCoreInfo: (payload: EmptyPayload) => CoreInfo;
  getKimiConfig: (payload: GetKimiConfigPayload) => LioraConfig;
  getConfigDiagnostics: (payload: EmptyPayload) => ConfigDiagnostics;
  setKimiConfig: (payload: SetKimiConfigPayload) => LioraConfig;
  removeKimiProvider: (payload: RemoveKimiProviderPayload) => LioraConfig;
  deleteConfigFields: (payload: DeleteConfigFieldsPayload) => LioraConfig;
  createSession: (payload: CreateSessionPayload) => SessionSummary;
  closeSession: (payload: CloseSessionPayload) => void;
  archiveSession: (payload: ArchiveSessionPayload) => void;
  resumeSession: (payload: ResumeSessionPayload) => ResumeSessionResult;
  reloadSession: (payload: ReloadSessionPayload) => ResumeSessionResult;
  forkSession: (payload: ForkSessionPayload) => ResumeSessionResult;
  listSessions: (payload: ListSessionsPayload) => readonly SessionSummary[];
  exportSession: (payload: ExportSessionPayload) => ExportSessionResult;
}
