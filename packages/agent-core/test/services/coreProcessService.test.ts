import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type ApprovalRequest,
  type ApprovalResponse,
  type Event,
  type QuestionRequest,
  type QuestionResult,
} from '../../src';
import { Emitter } from '../../src/base/common/event';

import {
  BridgeClientAPI,
  CoreProcessService,
  type IApprovalService,
  type IEnvironmentService,
  type IEventService,
  type ILogService,
  type IQuestionService,
} from '../../src/services';

class RecordingEventService implements IEventService {
  readonly _serviceBrand: undefined;

  readonly events: Event[] = [];
  private readonly _emitter = new Emitter<Event>();
  readonly onDidPublish = this._emitter.event;
  publish(event: Event): void {
    this.events.push(event);
    this._emitter.fire(event);
  }
}

class RecordingApprovalService implements IApprovalService {
  readonly _serviceBrand: undefined;

  readonly received: ApprovalRequest[] = [];
  readonly resolveCalls: Array<{ id: string; response: ApprovalResponse }> = [];
  async request(
    req: ApprovalRequest & { sessionId: string; agentId: string },
  ): Promise<ApprovalResponse> {
    this.received.push(req);
    return { decision: 'approved' };
  }
  resolve(id: string, response: ApprovalResponse): void {
    this.resolveCalls.push({ id, response });
  }
  listPending(): ReturnType<IApprovalService['listPending']> {
    return [];
  }
}

class RecordingQuestionService implements IQuestionService {
  readonly _serviceBrand: undefined;

  readonly received: QuestionRequest[] = [];
  readonly resolveCalls: Array<{ id: string; response: QuestionResult }> = [];
  readonly dismissCalls: string[] = [];
  async request(
    req: QuestionRequest & { sessionId: string; agentId: string },
  ): Promise<QuestionResult> {
    this.received.push(req);
    return null;
  }
  resolve(id: string, response: QuestionResult): void {
    this.resolveCalls.push({ id, response });
  }
  dismiss(id: string): void {
    this.dismissCalls.push(id);
  }
  listPending(): ReturnType<IQuestionService['listPending']> {
    return [];
  }
}

class NoopLogService implements ILogService {
  readonly _serviceBrand: undefined;

  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): ILogService {
    return this;
  }
}

let tmpHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'kimi-services-test-'));
  prevHome = process.env['KIMI_HOME'];
  process.env['KIMI_HOME'] = tmpHome;
});

afterEach(() => {
  if (prevHome === undefined) {
    delete process.env['KIMI_HOME'];
  } else {
    process.env['KIMI_HOME'] = prevHome;
  }
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
  }
});

function makePeers() {
  return {
    eventService: new RecordingEventService(),
    approvalService: new RecordingApprovalService(),
    questionService: new RecordingQuestionService(),
    logService: new NoopLogService(),
  };
}

function makeEnv(homeDir: string): IEnvironmentService {
  return {
    _serviceBrand: undefined,
    homeDir,
    configPath: join(homeDir, 'config.toml'),
  };
}

describe('BridgeClientAPI', () => {
  it('routes native event, approval, question and credential interactions', async () => {
    const { eventService, approvalService, questionService, logService } = makePeers();
    const api = new BridgeClientAPI({ eventService, approvalService, questionService, logService });

    const ev: Event = {
      type: 'agent_status_updated',
      sessionId: 'sess-1',
      agentId: 'main',
      status: { state: 'idle' },
    } as unknown as Event;
    api.emitEvent(ev);
    expect(eventService.events).toEqual([ev]);

    const approvalReq = {
      toolCallId: 'tc-1',
      toolName: 'Bash',
      action: 'execute',
      display: { kind: 'bash', command: 'printf native' } as ApprovalRequest['display'],
      sessionId: 'sess-1',
      agentId: 'main',
    };
    const approvalResp = await api.requestApproval(approvalReq);
    expect(approvalResp).toEqual({ decision: 'approved' });
    expect(approvalService.received).toHaveLength(1);

    const questionReq = {
      questions: [{ question: '?', options: [{ label: 'A' }] }],
      sessionId: 'sess-1',
      agentId: 'main',
    };
    const questionResp = await api.requestQuestion(questionReq);
    expect(questionResp).toBeNull();
    expect(questionService.received).toHaveLength(1);

    await expect(api.requestCredential({
      id: 'credential-1',
      title: 'Provider credential',
      sessionId: 'sess-1',
      agentId: 'main',
    })).resolves.toBeNull();
  });
});

describe('CoreProcessService direct construction', () => {

  it('rpc round-trip through createRPC reaches LioraCore (getCoreInfo smoke)', async () => {
    const { eventService, approvalService, questionService, logService } = makePeers();
    const core = new CoreProcessService(
      {},
      makeEnv(tmpHome),
      eventService,
      approvalService,
      questionService,
      logService,
    );
    try {
      await core.ready();
      const info = await core.rpc.getCoreInfo({});
      expect(info).toHaveProperty('version');
      expect(typeof info.version).toBe('string');
    } finally {
      await core.shutdown();
    }
  });

  it('dispose is idempotent and short-circuits subsequent rpc calls', async () => {
    const { eventService, approvalService, questionService, logService } = makePeers();
    const core = new CoreProcessService(
      {},
      makeEnv(tmpHome),
      eventService,
      approvalService,
      questionService,
      logService,
    );
    await core.ready();
    core.dispose();
    core.dispose();

    await expect(core.rpc.getCoreInfo({})).rejects.toThrow(/disposed/);
    const shutdown = core.shutdown();
    expect(core.shutdown()).toBe(shutdown);
    await shutdown;
  });

  it('shutdown awaits a native shell command before releasing the adapter', async () => {
    const peers = makePeers();
    const core = new CoreProcessService(
      {},
      makeEnv(tmpHome),
      peers.eventService,
      peers.approvalService,
      peers.questionService,
      peers.logService,
    );
    const started = Promise.withResolvers<void>();
    const subscription = peers.eventService.onDidPublish((event) => {
      if (event.type === 'shell.output' && event.commandId === 'shutdown-command') {
        started.resolve();
      }
    });
    try {
      await core.ready();
      const session = await core.rpc.createSession({ workDir: tmpHome });
      let commandSettled = false;
      const command = core.rpc.runShellCommand({
        sessionId: session.id,
        agentId: 'main',
        commandId: 'shutdown-command',
        command: 'printf transport-ready; exec sleep 30',
      }).finally(() => {
        commandSettled = true;
      });
      await started.promise;
      expect(commandSettled).toBe(false);
      core.dispose();
      await core.shutdown();
      expect(commandSettled).toBe(true);
      await command;
      await expect(core.rpc.getCoreInfo({})).rejects.toThrow(/disposed/);
    } finally {
      subscription.dispose();
      await core.shutdown();
    }
  });

});

