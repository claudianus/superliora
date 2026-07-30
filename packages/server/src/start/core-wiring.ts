import {
  setUnexpectedErrorHandler,
  IApprovalService,
  IAuthSummaryService,
  ICoreProcessService,
  IEventService,
  IFileStore,
  IFsGitService,
  IFsSearchService,
  IFsService,
  IFsWatcher,
  ILogService,
  IMessageService,
  IMcpService,
  IModelCatalogService,
  IOAuthService,
  IPromptService,
  IQuestionService,
  ISessionService,
  ISkillService,
  ITaskService,
  ITerminalService,
  IToolService,
  IWorkspaceFsService,
  IWorkspaceRegistry,
  FsWatcherService,
  createConnectionLookup,
  type InstantiationService,
  type ServiceCollection,
} from '@superliora/agent-core';

import {
  IConnectionRegistry,
  IRestGateway,
  ISessionClientsService,
  IWSBroadcastService,
  IWSGateway,
} from '#/services/gateway';
import type { IAuthTokenService } from '#/services/auth/authTokenService';
import { IModelCatalogRefreshScheduler } from '#/services/modelCatalog/modelCatalogRefreshScheduler';
import { ISnapshotService, loadSnapshotConfig } from '#/services/snapshot';
import { createFsWatchHandler } from './fs-watch';

export interface WireCoreProcessResult {
  coreProcess: ICoreProcessService;
  modelCatalogRefreshScheduler: IModelCatalogRefreshScheduler | undefined;
}

export function wireCoreProcessServices(
  ix: InstantiationService,
  services: ServiceCollection,
  authTokenService: IAuthTokenService,
): WireCoreProcessResult {
  let modelCatalogRefreshScheduler: IModelCatalogRefreshScheduler | undefined;
  const coreProcess = ix.invokeFunction((a) => {
    const log = a.get(ILogService);
    a.get(IRestGateway);

    setUnexpectedErrorHandler((err) => {
      log.error(
        err instanceof Error ? { msg: err.message, stack: err.stack } : { err },
        '[unexpected]',
      );
    });

    a.get(IConnectionRegistry);

    a.get(ISessionClientsService);

    a.get(IEventService);

    const wsBroadcast = a.get(IWSBroadcastService);

    a.get(IApprovalService);
    a.get(IQuestionService);

    // Eagerly instantiate the snapshot reader so its event-bus subscription
    // is in place before any session can publish `turn.started` events —
    // lazy-loading would drop turn lifecycle state for sessions created
    // before the first snapshot request.
    if (loadSnapshotConfig().mode !== 'legacy') {
      a.get(ISnapshotService);
    }

    const wsGw = a.get(IWSGateway);

    // Hand the override-aware auth impl to the WS gateway so the upgrade
    // path enforces the same token the HTTP hook uses (ROADMAP M5.1).
    wsGw.setAuthTokenService(authTokenService);

    const built = a.get(ICoreProcessService);

    const sessionService = a.get(ISessionService);
    a.get(IMessageService);

    a.get(IAuthSummaryService);

    a.get(IOAuthService);

    a.get(IModelCatalogService);
    modelCatalogRefreshScheduler = a.get(IModelCatalogRefreshScheduler);

    const promptService = a.get(IPromptService);
    const terminalService = a.get(ITerminalService);

    wsGw.setAbortHandler({
      abort: (sid, pid) => promptService.abort(sid, pid),
      currentSeq: (sid) => wsBroadcast.currentSeq(sid),
    });
    wsGw.setTerminalHandler({
      attach: (sessionId, terminalId, sink, options) =>
        terminalService.attach(sessionId, terminalId, sink, options),
      detach: (sessionId, terminalId, sinkId) =>
        terminalService.detach(sessionId, terminalId, sinkId),
      cleanupConnection: (sinkId) => terminalService.detachAllForSink(sinkId),
      write: (sessionId, terminalId, data) =>
        terminalService.write(sessionId, terminalId, data),
      resize: (sessionId, terminalId, cols, rows) =>
        terminalService.resize(sessionId, terminalId, cols, rows),
      close: (sessionId, terminalId) => terminalService.close(sessionId, terminalId),
    });

    a.get(IToolService);
    a.get(IMcpService);
    a.get(ISkillService);

    a.get(ITaskService);

    a.get(IFsService);

    a.get(IFsSearchService);

    a.get(IFsGitService);

    const registry = a.get(IConnectionRegistry);
    const fsWatcher = ix.createInstance(
      FsWatcherService,
      createConnectionLookup((id) => registry.get(id)),
      {},
    );
    services.set(IFsWatcher, fsWatcher);
    a.get(IFsWatcher);

    wsGw.setFsWatchHandler(createFsWatchHandler({ sessionService, fsWatcher }));

    a.get(IFileStore);

    a.get(IWorkspaceRegistry);

    a.get(IWorkspaceFsService);

    return built;
  });
  return { coreProcess, modelCatalogRefreshScheduler };
}
