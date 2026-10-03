import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { text } from 'node:stream/consumers';
import { join, normalize } from 'pathe';

import type { Kaos } from '@superliora/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Full LioraCore boot + kaos subprocess work exceeds the CI runner's 30s
// default under Windows load.
vi.setConfig({ testTimeout: 90_000 });

import {
  createRPC,
  ErrorCodes,
  LioraCore,
  LioraError,
  type ApprovalResponse,
  type CoreAPI,
  type SDKAPI,
} from '../../src';
import {
  __resetRootLoggerForTest,
} from '../../src/logging/logger';
import { openWireReadStream, resolveWirePath } from '../../src/session/store/wire-gzip';
import { isWithinWorkspace } from '../../src/tools/policies/path-access';
import { testKaos } from '../fixtures/test-kaos';


function setCoreKaos(core: LioraCore, kaos: Promise<Kaos>): void {
  (core as unknown as { kaos?: Promise<Kaos> }).kaos = kaos;
}

function setCoreKaosFailure(core: LioraCore, error: Error): void {
  (core as unknown as { getKaos: () => Promise<Kaos> }).getKaos = async () => {
    throw error;
  };
}

// Builds a Kaos that behaves like the ACP reverse-RPC bridge during
// `session/new`: reading a `local.toml` rejects with a non-ENOENT error because
// the client does not know the session yet (issue #988). Everything else
// delegates to the underlying kaos, so once the system-file read is routed
// through a working (local) kaos, session bootstrap can still proceed.
function createLocalTomlFailingKaos(base: Kaos): Kaos {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'readText') {
        return (
          path: string,
          options?: { encoding?: BufferEncoding; errors?: 'strict' | 'replace' | 'ignore' },
        ) => {
          if (String(path).endsWith('local.toml')) {
            return Promise.reject(
              new Error(`acp: readTextFile failed for ${path}: unknown session (issue #988)`),
            );
          }
          return target.readText(path, options);
        };
      }
      if (prop === 'withCwd') {
        return (cwd: string) => createLocalTomlFailingKaos(target.withCwd(cwd));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe('LioraCore runtime config', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp !== undefined) {
      await rm(tmp, { recursive: true, force: true });
    }
    await __resetRootLoggerForTest();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });


  // Regression for https://github.com/MoonshotAI/kimi-code/issues/988: during
  // ACP `session/new` the tool kaos is the reverse-RPC bridge and the client
  // does not know the session yet, so reading `.superliora/local.toml` through
  // it rejects. The workspace local config is a local system file and must be
  // read through the persistence (local) kaos instead.
  it('reads workspace local.toml through persistenceKaos during createSession', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const sharedDir = join(tmp, 'shared');
    await mkdir(homeDir, { recursive: true });
    await mkdir(join(workDir, '.git'), { recursive: true });
    await mkdir(join(workDir, '.superliora'), { recursive: true });
    await mkdir(sharedDir, { recursive: true });
    await writeFile(
      join(workDir, '.superliora', 'local.toml'),
      `[workspace]\nadditional_dir = ["../shared"]\n`,
    );
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await core.createSessionWithOverrides(
      { id: 'ses_runtime_local_toml_bootstrap', workDir, model: 'default-mock' },
      { kaos: createLocalTomlFailingKaos(testKaos), persistenceKaos: testKaos },
    );

    const session = core.sessions.get(created.id);
    expect(session).toBeDefined();
    expect(session?.getAdditionalDirs()).toContain(normalize(sharedDir));
  });


  it('falls back to defaultModel when createSession receives no model option', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(
      join(homeDir, 'config.toml'),
      `default_model = "default-mock"

[providers.test]
type = "kimi"
api_key = "test-key"

[models."default-mock"]
provider = "test"
model = "default-mock"
max_context_size = 100000
`,
    );

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({ id: 'ses_runtime_default_model', workDir });
    const session = core.sessions.get(created.id);
    const mainAgent = session?.getReadyAgent('main');

    expect(mainAgent?.config.modelAlias).toBe('default-mock');
  });

  it('loads project local additional dirs into the session and main agent', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const extraDir = join(workDir, 'extra');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(extraDir, { recursive: true });
    await mkdir(join(workDir, '.superliora'), { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());
    await writeFile(
      join(workDir, '.superliora', 'local.toml'),
      `[workspace]\nadditional_dir = ["extra"]\n`,
    );

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_additional_dirs',
      workDir,
      model: 'default-mock',
    });
    const session = core.sessions.get(created.id);
    const mainAgent = session?.getReadyAgent('main');

    expect(created.additionalDirs).toEqual([extraDir]);
    expect(session?.getAdditionalDirs()).toEqual([extraDir]);
    expect(mainAgent?.getAdditionalDirs()).toEqual([extraDir]);
  });

  it('returns additionalDirs when resuming an active session', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const extraDir = join(workDir, 'extra');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(extraDir, { recursive: true });
    await mkdir(join(workDir, '.superliora'), { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());
    await writeFile(
      join(workDir, '.superliora', 'local.toml'),
      `[workspace]\nadditional_dir = ["extra"]\n`,
    );

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_additional_dirs_active_resume',
      workDir,
      model: 'default-mock',
    });
    const resumed = await rpc.resumeSession({ sessionId: created.id });

    expect(resumed.additionalDirs).toEqual([extraDir]);
    expect(core.sessions.get(created.id)?.getAdditionalDirs()).toEqual([extraDir]);
  });

  it('returns additionalDirs when resuming a closed session', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const extraDir = join(workDir, 'extra');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(extraDir, { recursive: true });
    await mkdir(join(workDir, '.superliora'), { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());
    await writeFile(
      join(workDir, '.superliora', 'local.toml'),
      `[workspace]\nadditional_dir = ["extra"]\n`,
    );

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_additional_dirs_closed_resume',
      workDir,
      model: 'default-mock',
    });
    await rpc.closeSession({ sessionId: created.id });

    const resumed = await rpc.resumeSession({ sessionId: created.id });
    const session = core.sessions.get(created.id);
    const mainAgent = session?.getReadyAgent('main');

    expect(resumed.additionalDirs).toEqual([extraDir]);
    expect(session?.getAdditionalDirs()).toEqual([extraDir]);
    expect(mainAgent?.getAdditionalDirs()).toEqual([extraDir]);
  });

  it('merges caller additionalDirs when resuming a closed session', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const localDir = join(workDir, 'local');
    const callerDir = join(workDir, 'caller');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(localDir, { recursive: true });
    await mkdir(callerDir, { recursive: true });
    await mkdir(join(workDir, '.superliora'), { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());
    await writeFile(
      join(workDir, '.superliora', 'local.toml'),
      `[workspace]\nadditional_dir = ["local"]\n`,
    );

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_additional_dirs_resume_caller',
      workDir,
      model: 'default-mock',
    });
    await rpc.closeSession({ sessionId: created.id });

    const resumed = await rpc.resumeSession({
      sessionId: created.id,
      additionalDirs: ['caller'],
    });
    const session = core.sessions.get(created.id);
    const mainAgent = session?.getReadyAgent('main');

    expect(resumed.additionalDirs).toEqual([localDir, callerDir]);
    expect(session?.getAdditionalDirs()).toEqual([localDir, callerDir]);
    expect(mainAgent?.getAdditionalDirs()).toEqual([localDir, callerDir]);
  });

  it('deduplicates project local and caller relative additionalDirs after resolving them', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const sharedDir = join(workDir, 'shared');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(sharedDir, { recursive: true });
    await mkdir(join(workDir, '.superliora'), { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());
    await writeFile(
      join(workDir, '.superliora', 'local.toml'),
      `[workspace]\nadditional_dir = ["shared"]\n`,
    );

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_additional_dirs_dedupe',
      workDir,
      model: 'default-mock',
      additionalDirs: ['shared'],
    });

    expect(created.additionalDirs).toEqual([sharedDir]);
    expect(core.sessions.get(created.id)?.getAdditionalDirs()).toEqual([sharedDir]);
  });

  it('supports multiple project local and caller additionalDirs', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const localDir = join(workDir, 'shared');
    const callerDir = join(workDir, 'other');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(localDir, { recursive: true });
    await mkdir(callerDir, { recursive: true });
    await mkdir(join(workDir, '.superliora'), { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());
    await writeFile(
      join(workDir, '.superliora', 'local.toml'),
      `[workspace]\nadditional_dir = ["shared"]\n`,
    );

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    void new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_additional_dirs_multiple',
      workDir,
      model: 'default-mock',
      additionalDirs: ['other'],
    });

    expect(created.additionalDirs).toEqual([localDir, callerDir]);
  });

  it('resolves caller relative additionalDirs against workDir rather than projectRoot', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const projectRoot = join(tmp, 'repo');
    const workDir = join(projectRoot, 'apps', 'foo');
    const sharedDir = join(workDir, 'shared');
    await mkdir(homeDir, { recursive: true });
    await mkdir(join(projectRoot, '.git'), { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(sharedDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_additional_dirs_workdir_relative',
      workDir,
      model: 'default-mock',
      additionalDirs: ['shared'],
    });

    expect(created.additionalDirs).toEqual([sharedDir]);
    expect(core.sessions.get(created.id)?.getAdditionalDirs()).toEqual([sharedDir]);
  });

  it('adds a remembered directory without injecting conversation messages', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const extraDir = join(tmp, 'extra');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(extraDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_add_additional_dir_record',
      workDir,
      model: 'default-mock',
    });
    const scoped = { sessionId: created.id, agentId: 'main' };
    const beforeConfig = await rpc.getConfig(scoped);
    const beforePermission = await rpc.getPermission(scoped);
    expect(isWithinWorkspace(extraDir, {
      workspaceDir: workDir,
      additionalDirs: core.sessions.get(created.id)!.getAdditionalDirs(),
    })).toBe(false);

    await rpc.addAdditionalDir({
      sessionId: created.id,
      path: extraDir,
      persist: true,
    });
    await core.sessions.get(created.id)?.getReadyAgent('main')?.records.flush();

    const records = await readMainWire(created.sessionDir);
    expect(records.filter((record) => record['type'] === 'context.append_message')).toEqual([]);
    expect(core.sessions.get(created.id)?.getReadyAgent('main')?.getAdditionalDirs()).toEqual([
      extraDir,
    ]);
    expect(isWithinWorkspace(extraDir, {
      workspaceDir: workDir,
      additionalDirs: core.sessions.get(created.id)!.getReadyAgent('main')!.getAdditionalDirs(),
    })).toBe(true);
    expect((await rpc.getConfig(scoped)).systemPrompt).toBe(beforeConfig.systemPrompt);
    expect(await rpc.getPermission(scoped)).toEqual(beforePermission);

    await rpc.closeSession({ sessionId: created.id });
    expect((await readMainWire(created.sessionDir))
      .filter((record) => record['type'] === 'context.append_message')).toEqual([]);
    const resumed = await rpc.resumeSession({ sessionId: created.id });
    expect(resumed.additionalDirs).toEqual([extraDir]);
    expect(core.sessions.get(created.id)?.getReadyAgent('main')?.getAdditionalDirs()).toEqual([extraDir]);
    expect(await rpc.getPermission(scoped)).toEqual(beforePermission);
  });

  it('adds an additional dir through the session RPC', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const extraDir = join(workDir, 'extra');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(extraDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_add_additional_dir',
      workDir,
      model: 'default-mock',
    });

    const result = await rpc.addAdditionalDir({
      sessionId: created.id,
      path: 'extra',
      persist: true,
    });
    const localToml = await readFile(join(workDir, '.superliora', 'local.toml'), 'utf-8');
    const session = core.sessions.get(created.id);
    const mainAgent = session?.getReadyAgent('main');

    expect(result).toMatchObject({
      additionalDirs: [extraDir],
      projectRoot: workDir,
      configPath: join(workDir, '.superliora', 'local.toml'),
      persisted: true,
    });
    expect(localToml).toContain('additional_dir = [');
    expect(session?.getAdditionalDirs()).toEqual([extraDir]);
    expect(mainAgent?.getAdditionalDirs()).toEqual([extraDir]);
    await rpc.closeSession({ sessionId: created.id });
    const resumed = await rpc.resumeSession({ sessionId: created.id });
    expect(resumed.additionalDirs).toEqual([extraDir]);
    expect(core.sessions.get(created.id)?.getReadyAgent('main')?.getAdditionalDirs()).toEqual([extraDir]);
  });

  it('adds a session-only additional dir without writing local.toml', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const extraDir = join(workDir, 'extra');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(extraDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_add_session_only_dir',
      workDir,
      model: 'default-mock',
    });

    const result = await rpc.addAdditionalDir({
      sessionId: created.id,
      path: 'extra',
      persist: false,
    });
    await core.sessions.get(created.id)?.getReadyAgent('main')?.records.flush();
    const records = await readMainWire(created.sessionDir);

    expect(result).toMatchObject({
      additionalDirs: [extraDir],
      projectRoot: workDir,
      configPath: join(workDir, '.superliora', 'local.toml'),
      persisted: false,
    });
    expect(core.sessions.get(created.id)?.getAdditionalDirs()).toEqual([extraDir]);
    expect(records.filter((record) => record['type'] === 'context.append_message')).toEqual([]);
    await expect(readFile(join(workDir, '.superliora', 'local.toml'), 'utf-8')).rejects.toThrow();
    const reloaded = await rpc.reloadSession({ sessionId: created.id });
    expect(reloaded.additionalDirs).toEqual([extraDir]);
    expect(core.sessions.get(created.id)?.getReadyAgent('main')?.getAdditionalDirs()).toEqual([extraDir]);
  });

  it('rejects createSession when shell runtime initialization fails', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });
    setCoreKaosFailure(
      core,
      new LioraError(ErrorCodes.SHELL_GIT_BASH_NOT_FOUND, 'Git Bash missing'),
    );

    await expect(
      rpc.createSession({
        id: 'ses_runtime_shell_missing_create',
        workDir,
        model: 'default-mock',
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SHELL_GIT_BASH_NOT_FOUND });
    expect(core.sessions.has('ses_runtime_shell_missing_create')).toBe(false);
  });

  it('rejects resumeSession when shell runtime initialization fails', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });
    setCoreKaos(core, Promise.resolve(testKaos));
    const created = await rpc.createSession({
      id: 'ses_runtime_shell_missing_resume',
      workDir,
      model: 'default-mock',
    });
    await rpc.closeSession({ sessionId: created.id });
    setCoreKaosFailure(
      core,
      new LioraError(ErrorCodes.SHELL_GIT_BASH_NOT_FOUND, 'Git Bash missing'),
    );

    await expect(rpc.resumeSession({ sessionId: created.id })).rejects.toMatchObject({
      code: ErrorCodes.SHELL_GIT_BASH_NOT_FOUND,
    });
    expect(core.sessions.has(created.id)).toBe(false);
  });

  it('reloads an active session with updated native model capabilities from config.toml', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const configPath = join(homeDir, 'config.toml');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(configPath, baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_reload',
      workDir,
      model: 'default-mock',
    });
    const before = core.sessions.get(created.id);
    expect((await rpc.getConfig({ sessionId: created.id, agentId: 'main' })).modelCapabilities.max_context_tokens).toBe(100000);

    await writeFile(
      configPath,
      baseModelConfig().replace('max_context_size = 100000', 'max_context_size = 200000'),
    );

    const reloaded = await rpc.reloadSession({ sessionId: created.id });
    const after = core.sessions.get(created.id);

    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(reloaded.agents['main']?.config.modelCapabilities.max_context_tokens).toBe(200000);
    expect((await rpc.getConfig({ sessionId: created.id, agentId: 'main' })).modelCapabilities.max_context_tokens).toBe(200000);
  });

  it('rejects reloadSession while the active session has a running turn', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'kimi-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new LioraCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_reload_busy',
      workDir,
      model: 'default-mock',
    });
    const active = core.sessions.get(created.id);
    const main = active?.getReadyAgent('main');
    vi.spyOn(main!.turn, 'hasActiveTurn', 'get').mockReturnValue(true);

    await expect(rpc.reloadSession({ sessionId: created.id })).rejects.toMatchObject({
      code: ErrorCodes.TURN_AGENT_BUSY,
    });
    expect(core.sessions.get(created.id)).toBe(active);
  });
});

async function readMainWire(sessionDir: string): Promise<readonly Record<string, unknown>[]> {
  const wirePath = await resolveWirePath(join(sessionDir, 'agents', 'main'));
  expect(wirePath).toBeDefined();
  const wire = await text(openWireReadStream(wirePath!));
  return wire
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function baseModelConfig(): string {
  return `default_model = "default-mock"

[providers.test]
type = "kimi"
api_key = "test-key"

[models."default-mock"]
provider = "test"
model = "default-mock"
max_context_size = 100000
`;
}
