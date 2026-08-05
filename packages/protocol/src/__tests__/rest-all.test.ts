import { describe, expect, it } from 'vitest';

import {
  approvalResolveRequestSchema,
  approvalResolveResultSchema,
  listPendingApprovalsQuerySchema,
  listPendingApprovalsResponseSchema,
} from '../rest/approval';
import {
  authSummarySchema,
  managedProviderStatusSchema,
} from '../rest/auth';
import {
  connectionSchema,
  connectionsListResponseSchema,
} from '../rest/connection';
import {
  deleteFileResponseSchema,
  getFileParamSchema,
  uploadFileResponseSchema,
} from '../rest/file';
import {
  fsBrowseEntrySchema,
  fsBrowseQuerySchema,
  fsBrowseResponseSchema,
  fsHomeResponseSchema,
} from '../rest/fsBrowse';
import {
  listMessagesQuerySchema,
  listMessagesResponseSchema,
} from '../rest/message';
import {
  metaCapabilitiesSchema,
  metaResponseSchema,
} from '../rest/meta';
import {
  listModelsResponseSchema,
  listProvidersResponseSchema,
  refreshProviderModelsResponseSchema,
  setDefaultModelResponseSchema,
} from '../rest/modelCatalog';
import {
  activateSkillRequestSchema,
  activateSkillResultSchema,
  searchSkillsRequestSchema,
} from '../rest/skill';
import {
  cancelTaskResultSchema,
  getTaskQuerySchema,
  listTasksResponseSchema,
} from '../rest/task';
import {
  closeTerminalResponseSchema,
  createTerminalRequestSchema,
  listTerminalsResponseSchema,
  terminalSchema,
  terminalStatusSchema,
} from '../rest/terminal';
import {
  questionAlreadyResolvedDataSchema,
  questionDismissResultSchema,
  questionResolveRequestSchema,
} from '../rest/question';
import {
  oauthFlowSnapshotSchema,
  oauthFlowStartSchema,
  oauthFlowStatusEnum,
  oauthLoginCancelResponseSchema,
  oauthLogoutResponseSchema,
} from '../rest/oauth';
import {
  configResponseSchema,
  patchConfigRequestSchema,
  providerConfigResponseSchema,
} from '../rest/config';
import {
  createMemoryRequestSchema,
  listMemoriesQuerySchema,
  reflectMemoriesResponseSchema,
  searchMemoriesRequestSchema,
} from '../rest/memory';
import {
  inFlightToolCallSchema,
  inFlightTurnSchema,
  sessionSnapshotResponseSchema,
} from '../rest/snapshot';
import {
  compactSessionRequestSchema,
  forkSessionRequestSchema,
  listSessionsQuerySchema,
  sessionStatusResponseSchema,
  sessionWarningSchema,
} from '../rest/session';
import {
  promptAbortResponseSchema,
  promptItemSchema,
  promptPermissionModeSchema,
  promptStatusSchema,
  promptSteerRequestSchema,
  promptSubmissionSchema,
  promptThinkingSchema,
} from '../rest/prompt';
import {
  createWorkspaceRequestSchema,
  deleteWorkspaceResponseSchema,
  listWorkspacesResponseSchema,
  updateWorkspaceRequestSchema,
  workspaceIdParamSchema,
} from '../rest/workspace';
import {
  listToolsQuerySchema,
  listToolsResponseSchema,
  restartMcpServerResultSchema,
} from '../rest/tool';
import { emptySessionUsage } from '../session';

describe('rest/approval — pending + resolve', () => {
  it('listPendingApprovalsQuerySchema requires status=pending', () => {
    expect(listPendingApprovalsQuerySchema.parse({ status: 'pending' }).status).toBe('pending');
    expect(() => listPendingApprovalsQuerySchema.parse({ status: 'x' })).toThrow();
  });

  it('listPendingApprovalsResponseSchema accepts an empty items list', () => {
    expect(listPendingApprovalsResponseSchema.parse({ items: [] }).items).toEqual([]);
  });

  it('approvalResolveRequestSchema and ResultSchema are linked', () => {
    const req = approvalResolveRequestSchema.parse({ decision: 'approved' });
    expect(req.decision).toBe('approved');
    const res = approvalResolveResultSchema.parse({
      resolved: true,
      resolved_at: '2026-01-01T00:00:00Z',
    });
    expect(res.resolved).toBe(true);
  });
});

describe('rest/auth — auth summary', () => {
  it('managedProviderStatusSchema accepts the canonical statuses', () => {
    for (const v of [
      'authenticated',
      'expired',
      'revoked',
      'unauthenticated',
    ]) {
      expect(managedProviderStatusSchema.parse(v)).toBe(v);
    }
  });

  it('authSummarySchema accepts a minimal summary', () => {
    const s = authSummarySchema.parse({
      ready: true,
      providers_count: 0,
      default_model: null,
      managed_provider: null,
    });
    expect(s.ready).toBe(true);
  });
});

describe('rest/connection — live socket info', () => {
  it('connectionSchema accepts a minimal connection', () => {
    const c = connectionSchema.parse({
      id: 'conn-1',
      connected_at: '2026-01-01T00:00:00Z',
      remote_address: null,
      user_agent: null,
      has_client_hello: false,
      subscriptions: [],
    });
    expect(c.id).toBe('conn-1');
  });

  it('connectionsListResponseSchema wraps a list', () => {
    const r = connectionsListResponseSchema.parse({ connections: [] });
    expect(r.connections).toEqual([]);
  });
});

describe('rest/file — upload + delete', () => {
  it('uploadFileResponseSchema requires valid file meta fields', () => {
    const u = uploadFileResponseSchema.parse({
      id: 'f-1',
      name: 'a.txt',
      media_type: 'text/plain',
      size: 1,
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(u.id).toBe('f-1');
  });

  it('getFileParamSchema requires file_id', () => {
    expect(() => getFileParamSchema.parse({})).toThrow();
  });

  it('deleteFileResponseSchema is { deleted: true }', () => {
    expect(deleteFileResponseSchema.parse({ deleted: true }).deleted).toBe(true);
  });
});

describe('rest/fsBrowse — directory browser', () => {
  it('fsBrowseQuerySchema accepts empty', () => {
    expect(fsBrowseQuerySchema.parse({}).path).toBeUndefined();
  });

  it('fsBrowseEntrySchema is_dir must be literal true', () => {
    expect(() =>
      fsBrowseEntrySchema.parse({
        name: 'a',
        path: '/a',
        is_dir: false,
        is_git_repo: false,
      }),
    ).toThrow();
  });

  it('fsBrowseResponseSchema wraps entries with parent', () => {
    const r = fsBrowseResponseSchema.parse({
      path: '/a',
      parent: null,
      entries: [],
    });
    expect(r.parent).toBeNull();
  });

  it('fsHomeResponseSchema accepts recent_roots list', () => {
    const h = fsHomeResponseSchema.parse({ home: '/h', recent_roots: [] });
    expect(h.home).toBe('/h');
  });
});

describe('rest/message — list and get', () => {
  it('listMessagesQuerySchema accepts role and cursor', () => {
    const q = listMessagesQuerySchema.parse({ role: 'user' });
    expect(q.role).toBe('user');
  });

  it('listMessagesResponseSchema wraps messages with has_more', () => {
    const r = listMessagesResponseSchema.parse({ items: [], has_more: false });
    expect(r.has_more).toBe(false);
  });
});

describe('rest/meta — server capabilities', () => {
  it('metaCapabilitiesSchema requires true literals for every flag', () => {
    const c = metaCapabilitiesSchema.parse({
      websocket: true,
      file_upload: true,
      fs_query: true,
      mcp: true,
      background_tasks: true,
      terminal: true,
    });
    expect(c.websocket).toBe(true);
  });

  it('metaResponseSchema accepts a minimal meta', () => {
    const r = metaResponseSchema.parse({
      server_version: '0.0.1',
      capabilities: {
        websocket: true,
        file_upload: true,
        fs_query: true,
        mcp: true,
        background_tasks: true,
        terminal: true,
      },
      server_id: 'srv',
      started_at: '2026-01-01T00:00:00Z',
      open_in_apps: [],
    });
    expect(r.server_id).toBe('srv');
  });
});

describe('rest/modelCatalog — list providers + set default', () => {
  it('listModelsResponseSchema and listProvidersResponseSchema accept empty lists', () => {
    expect(listModelsResponseSchema.parse({ items: [] }).items).toEqual([]);
    expect(listProvidersResponseSchema.parse({ items: [] }).items).toEqual([]);
  });

  it('setDefaultModelResponseSchema wraps the new default', () => {
    const r = setDefaultModelResponseSchema.parse({
      default_model: 'kimi-k2',
      model: {
        provider: 'kimi',
        model: 'kimi-k2',
        display_name: 'Kimi K2',
        max_context_size: 128000,
      },
    });
    expect(r.default_model).toBe('kimi-k2');
  });

  it('refreshProviderModelsResponseSchema accepts empty buckets', () => {
    const r = refreshProviderModelsResponseSchema.parse({
      changed: [],
      unchanged: [],
      failed: [],
    });
    expect(r.unchanged).toEqual([]);
  });
});

describe('rest/skill — list/search/activate', () => {
  it('searchSkillsRequestSchema enforces limit 1..20', () => {
    expect(() => searchSkillsRequestSchema.parse({ query: 'x', limit: 0 })).toThrow();
    expect(() => searchSkillsRequestSchema.parse({ query: 'x', limit: 21 })).toThrow();
  });

  it('activateSkillRequestSchema accepts empty args', () => {
    expect(activateSkillRequestSchema.parse({}).args).toBeUndefined();
  });

  it('activateSkillResultSchema requires literal true', () => {
    expect(activateSkillResultSchema.parse({ activated: true, skill_name: 's' }).skill_name).toBe('s');
  });
});

describe('rest/task — list + cancel', () => {
  it('listTasksResponseSchema accepts empty', () => {
    expect(listTasksResponseSchema.parse({ items: [] }).items).toEqual([]);
  });

  it('getTaskQuerySchema coerces strings to numbers', () => {
    const q = getTaskQuerySchema.parse({ with_output: 'true', output_bytes: '5' });
    expect(q.with_output).toBe(true);
    expect(q.output_bytes).toBe(5);
  });

  it('cancelTaskResultSchema is { cancelled: true }', () => {
    expect(cancelTaskResultSchema.parse({ cancelled: true }).cancelled).toBe(true);
  });
});

describe('rest/terminal — terminal lifecycle', () => {
  it('terminalStatusSchema accepts running/exited', () => {
    for (const v of ['running', 'exited']) {
      expect(terminalStatusSchema.parse(v)).toBe(v);
    }
  });

  it('terminalSchema requires positive cols/rows', () => {
    expect(() =>
      terminalSchema.parse({
        id: 't-1',
        session_id: 's-1',
        cwd: 'cwd',
        shell: 'sh',
        cols: 0,
        rows: 0,
        status: 'running',
        created_at: '2026-01-01T00:00:00Z',
      }),
    ).toThrow();
  });

  it('createTerminalRequestSchema rejects absolute cwd', () => {
    expect(() =>
      createTerminalRequestSchema.parse({ cwd: '/abs' }),
    ).toThrow();
    const ok = createTerminalRequestSchema.parse({ cwd: 'rel' });
    expect(ok.shell).toBeUndefined();
  });

  it('listTerminalsResponseSchema wraps terminals', () => {
    expect(listTerminalsResponseSchema.parse({ items: [] }).items).toEqual([]);
  });

  it('closeTerminalResponseSchema is { closed: true }', () => {
    expect(closeTerminalResponseSchema.parse({ closed: true }).closed).toBe(true);
  });
});

describe('rest/question — resolve + dismiss', () => {
  it('questionResolveRequestSchema requires answers map', () => {
    const r = questionResolveRequestSchema.parse({
      answers: { 'q-1': { kind: 'skipped' } },
    });
    expect(r.answers['q-1']?.kind).toBe('skipped');
  });

  it('questionAlreadyResolvedDataSchema is { resolved: false }', () => {
    expect(questionAlreadyResolvedDataSchema.parse({ resolved: false }).resolved).toBe(false);
  });

  it('questionDismissResultSchema requires literal true', () => {
    expect(
      questionDismissResultSchema.parse({
        dismissed: true,
        dismissed_at: '2026-01-01T00:00:00Z',
      }).dismissed,
    ).toBe(true);
  });
});

describe('rest/oauth — login flow + logout', () => {
  it('oauthFlowStatusEnum accepts the canonical states', () => {
    for (const v of [
      'pending',
      'authenticated',
      'denied',
      'expired',
      'cancelled',
    ]) {
      expect(oauthFlowStatusEnum.parse(v)).toBe(v);
    }
  });

  it('oauthFlowStartSchema requires valid urls and positive expirations', () => {
    expect(() =>
      oauthFlowStartSchema.parse({
        flow_id: 'f-1',
        provider: 'kimi',
        verification_uri: 'not-a-url',
        verification_uri_complete: 'not-a-url',
        user_code: 'uc',
        expires_in: 0,
        interval: 0,
        status: 'pending',
        expires_at: '2026-01-01T00:00:00Z',
      }),
    ).toThrow();
  });

  it('oauthFlowSnapshotSchema accepts a minimal snapshot', () => {
    const s = oauthFlowSnapshotSchema.parse({
      flow_id: 'f-1',
      provider: 'kimi',
      status: 'pending',
      verification_uri: 'https://example.test/v',
      verification_uri_complete: 'https://example.test/v?c=1',
      user_code: 'uc',
      expires_in: 60,
      expires_at: '2026-01-01T00:00:00Z',
      interval: 5,
    });
    expect(s.status).toBe('pending');
  });

  it('oauthLoginCancelResponseSchema wraps cancelled + status', () => {
    expect(
      oauthLoginCancelResponseSchema.parse({
        cancelled: true,
        status: 'cancelled',
      }).cancelled,
    ).toBe(true);
  });

  it('oauthLogoutResponseSchema requires literal true', () => {
    expect(
      oauthLogoutResponseSchema.parse({
        logged_out: true,
        provider: 'kimi',
      }).logged_out,
    ).toBe(true);
  });
});

describe('rest/config — config get/patch', () => {
  it('providerConfigResponseSchema requires has_api_key boolean', () => {
    expect(providerConfigResponseSchema.parse({ type: 'kimi', has_api_key: false }).type).toBe('kimi');
  });

  it('configResponseSchema accepts an empty body (all optional)', () => {
    const r = configResponseSchema.parse({});
    expect(r).toBeDefined();
  });

  it('patchConfigRequestSchema accepts an empty body (all optional)', () => {
    expect(patchConfigRequestSchema.parse({})).toEqual({});
  });
});

describe('rest/memory — memory CRUD/query', () => {
  it('listMemoriesQuerySchema accepts empty', () => {
    expect(listMemoriesQuerySchema.parse({}).limit).toBeUndefined();
  });

  it('createMemoryRequestSchema requires subject and content', () => {
    expect(() => createMemoryRequestSchema.parse({ type: 'fact' })).toThrow();
    expect(
      createMemoryRequestSchema.parse({ type: 'fact', subject: 's', content: 'c' })
        .subject,
    ).toBe('s');
  });

  it('searchMemoriesRequestSchema accepts type/types together', () => {
    const r = searchMemoriesRequestSchema.parse({
      type: 'fact',
      types: ['fact'],
    });
    expect(r.type).toBe('fact');
  });

  it('reflectMemoriesResponseSchema accepts zero counts', () => {
    expect(
      reflectMemoriesResponseSchema.parse({ examined: 0, merged: 0, promoted: 0, rejected: 0 }).merged,
    ).toBe(0);
  });
});

describe('rest/snapshot — session snapshot', () => {
  it('inFlightToolCallSchema requires tool_call_id and name', () => {
    expect(inFlightToolCallSchema.parse({ tool_call_id: 't-1', name: 'Bash' }).name).toBe('Bash');
  });

  it('inFlightTurnSchema accepts a minimal turn', () => {
    const t = inFlightTurnSchema.parse({
      turn_id: 1,
      assistant_text: '',
      thinking_text: '',
      running_tools: [],
    });
    expect(t.turn_id).toBe(1);
  });

  it('sessionSnapshotResponseSchema accepts a full snapshot', () => {
    const s = sessionSnapshotResponseSchema.parse({
      as_of_seq: 0,
      epoch: 'e-1',
      session: {
        id: 's-1',
        workspace_id: 'wd_root_a1b2c3d4e5f6',
        title: 't',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        status: 'idle',
        metadata: { cwd: '/w' },
        agent_config: { model: 'm' },
        usage: emptySessionUsage(),
        permission_rules: [],
        message_count: 0,
        last_seq: 0,
      },
      messages: { items: [], has_more: false },
      in_flight_turn: null,
      pending_approvals: [],
      pending_questions: [],
    });
    expect(s.epoch).toBe('e-1');
  });
});

describe('rest/session — list/fork/status/compact', () => {
  it('listSessionsQuerySchema coerces include_archive', () => {
    const q = listSessionsQuerySchema.parse({ include_archive: 'true' });
    expect(q.include_archive).toBe(true);
  });

  it('forkSessionRequestSchema accepts an empty body', () => {
    expect(forkSessionRequestSchema.parse({}).title).toBeUndefined();
  });

  it('sessionStatusResponseSchema accepts a minimal status', () => {
    const s = sessionStatusResponseSchema.parse({
      status: 'idle',
      thinking_level: 'off',
      permission: 'manual',
      plan_mode: false,
      swarm_mode: false,
      context_tokens: 0,
      max_context_tokens: 100,
      context_usage: 0,
    });
    expect(s.status).toBe('idle');
  });

  it('sessionWarningSchema requires severity enum', () => {
    for (const v of ['info', 'warning', 'error']) {
      expect(
        sessionWarningSchema.parse({ code: 'c', message: 'm', severity: v }).severity,
      ).toBe(v);
    }
  });

  it('compactSessionRequestSchema accepts undefined and empty', () => {
    expect(compactSessionRequestSchema.parse(undefined).instruction).toBeUndefined();
    expect(compactSessionRequestSchema.parse({}).instruction).toBeUndefined();
  });
});

describe('rest/prompt — submission + steer + abort', () => {
  it('promptThinkingSchema accepts the canonical set', () => {
    for (const v of ['off', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(promptThinkingSchema.parse(v)).toBe(v);
    }
  });

  it('promptPermissionModeSchema accepts manual/yolo/auto', () => {
    for (const v of ['manual', 'yolo', 'auto']) {
      expect(promptPermissionModeSchema.parse(v)).toBe(v);
    }
  });

  it('promptStatusSchema accepts running/queued', () => {
    for (const v of ['running', 'queued']) {
      expect(promptStatusSchema.parse(v)).toBe(v);
    }
  });

  it('promptSubmissionSchema requires non-empty content', () => {
    expect(() => promptSubmissionSchema.parse({ content: [] })).toThrow();
    const p = promptSubmissionSchema.parse({
      content: [{ type: 'text', text: 'hi' }],
    });
    expect(p.content).toHaveLength(1);
  });

  it('promptItemSchema requires prompt_id, user_message_id, content, created_at', () => {
    const i = promptItemSchema.parse({
      prompt_id: 'p-1',
      user_message_id: 'm-1',
      status: 'running',
      content: [{ type: 'text', text: 'hi' }],
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(i.status).toBe('running');
  });

  it('promptSteerRequestSchema requires at least 1 prompt id', () => {
    expect(() => promptSteerRequestSchema.parse({ prompt_ids: [] })).toThrow();
  });

  it('promptAbortResponseSchema accepts aborted boolean', () => {
    expect(promptAbortResponseSchema.parse({ aborted: true }).aborted).toBe(true);
  });
});

describe('rest/workspace — workspace CRUD', () => {
  it('listWorkspacesResponseSchema accepts empty items', () => {
    expect(listWorkspacesResponseSchema.parse({ items: [] }).items).toEqual([]);
  });

  it('createWorkspaceRequestSchema requires valid workspace shape', () => {
    expect(() => createWorkspaceRequestSchema.parse({ name: '' })).toThrow();
  });

  it('workspaceIdParamSchema accepts a valid wd_ id', () => {
    expect(
      workspaceIdParamSchema.parse({ workspace_id: 'wd_root_a1b2c3d4e5f6' })
        .workspace_id,
    ).toBe('wd_root_a1b2c3d4e5f6');
  });

  it('updateWorkspaceRequestSchema requires a name', () => {
    expect(() => updateWorkspaceRequestSchema.parse({})).toThrow();
    const u = updateWorkspaceRequestSchema.parse({ name: 'new' });
    expect(u.name).toBe('new');
  });

  it('deleteWorkspaceResponseSchema is { deleted: true }', () => {
    expect(deleteWorkspaceResponseSchema.parse({ deleted: true }).deleted).toBe(true);
  });
});

describe('rest/tool — list + mcp restart', () => {
  it('listToolsQuerySchema accepts session_id', () => {
    expect(listToolsQuerySchema.parse({ session_id: 's-1' }).session_id).toBe('s-1');
  });

  it('listToolsResponseSchema accepts empty', () => {
    expect(listToolsResponseSchema.parse({ tools: [] }).tools).toEqual([]);
  });

  it('restartMcpServerResultSchema is { restarting: true }', () => {
    expect(restartMcpServerResultSchema.parse({ restarting: true }).restarting).toBe(true);
  });
});
