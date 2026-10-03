import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runArtifactVerification, sealVerificationArtifact, verificationEnvironment, type VerificationStage, type VerificationHostPolicy } from '../../../src/session/execution/verification';

const roots: string[] = [];
// Tests are the trusted host; production must supply a real workspace/argv authorization policy.
const hostPolicy: VerificationHostPolicy = { authorize: () => {} };
const requirementsHash = createHash('sha256').update('fixed requirements').digest('hex');
const git = (repo: string, ...args: string[]): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'verification-test-'));
  roots.push(root);
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Test User');
  git(root, 'config', 'user.email', 'test@example.test');
  await writeFile(join(root, 'source.txt'), 'sealed source');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'test: create fixture');
  const revision = git(root, 'rev-parse', 'HEAD');
  const seal = (stages: readonly VerificationStage[]) => sealVerificationArtifact({ hostPolicy, repoPath: root, sourceRevision: revision, requirementsHash, stages });
  const run = async (stages: readonly VerificationStage[], currentRequirementsHash = () => requirementsHash) =>
    runArtifactVerification({ hostPolicy, repoPath: root, artifact: await seal(stages), evidenceRoot: await mkdtemp(join(tmpdir(), 'verification-evidence-')).then(path => { roots.push(path); return path; }), currentRequirementsHash });
  return { root, revision, seal, run };
}
const stage = (id: string, script: string, timeoutMs = 10_000): VerificationStage => ({ id, command: [process.execPath, '-e', script], scope: '.', timeoutMs });
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('revision sealed verification', () => {
  it('executes the sealed commit, not the dirty/moving producer, and persists actual evidence', async () => {
    const f = await fixture();
    const stages = [stage('test', "console.log(require('fs').readFileSync('source.txt','utf8')); console.log(process.env.TZ, process.env.CI); console.error('diagnostic')")];
    const artifact = await f.seal(stages);
    await writeFile(join(f.root, 'source.txt'), 'new revision');
    git(f.root, 'add', 'source.txt');
    git(f.root, 'commit', '-m', 'test: advance producer');
    await writeFile(join(f.root, 'source.txt'), 'dirty producer');
    const receipt = await runArtifactVerification({ hostPolicy, repoPath: f.root, artifact, evidenceRoot: join(f.root, 'evidence'), currentRequirementsHash: () => requirementsHash });
    expect(receipt.status).toBe('passed');
    expect(receipt.sourceRevision).toBe(f.revision);
    expect(receipt.artifactHash).toBe(artifact.artifactHash);
    expect(receipt.stages[0]?.command).toEqual(stages[0]?.command);
    expect(receipt.stages[0]?.cwd).not.toBe(f.root);
    expect(receipt.stages[0]?.exitCode).toBe(0);
    expect(await readFile(receipt.stages[0]!.stdoutPath, 'utf8')).toBe('sealed source\nUTC true\n');
    expect(await readFile(receipt.stages[0]!.stderrPath, 'utf8')).toBe('diagnostic\n');
    expect(JSON.parse(await readFile(receipt.evidencePath, 'utf8'))).toEqual(receipt);
    expect(await readFile(join(f.root, 'source.txt'), 'utf8')).toBe('dirty producer');
  });

  it('fails fast with the actual exit code and never retries or runs later stages', async () => {
    const f = await fixture();
    const receipt = await f.run([stage('fail', 'process.exit(7)'), stage('not_run', "throw new Error('must not run')")]);
    expect(receipt.status).toBe('failed');
    expect(receipt.stages).toHaveLength(1);
    expect(receipt.stages[0]?.exitCode).toBe(7);
  });

  it('bounds hung commands and retains timeout evidence', async () => {
    const f = await fixture();
    const receipt = await f.run([stage('hang', 'setInterval(() => {}, 1000)', 100)]);
    expect(receipt.status).toBe('failed');
    expect(receipt.stages[0]?.timedOut).toBe(true);
    expect(receipt.stages[0]?.exitCode).not.toBe(0);
  });

  it('cancels an owned running process tree and resolves only with settled evidence', async () => {
    const f = await fixture();
    const marker = join(f.root, 'started-marker');
    const script = "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit'}); " +
      "console.log('started'); require('fs').writeFileSync(" + JSON.stringify(marker) + ", 'ready'); setInterval(() => {}, 1000)";
    const artifact = await f.seal([stage('owned_tree', script), stage('later', "throw new Error('must not run')")]);
    const controller = new AbortController();
    let settled = false;
    const pending = runArtifactVerification({ hostPolicy, repoPath: f.root, artifact,
      evidenceRoot: join(f.root, 'evidence'), currentRequirementsHash: () => requirementsHash,
      signal: controller.signal }).then(receipt => { settled = true; return receipt; });
    // Synchronize to command readiness, not elapsed runtime.
    while (true) {
      try { await readFile(marker); break; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    controller.abort(new Error('operator stop'));
    expect(settled).toBe(false); // Request acknowledgement is not settlement.
    const receipt = await pending;
    expect(receipt.status).toBe('cancelled');
    expect(receipt.stages).toHaveLength(1);
    expect(receipt.stages[0]?.cancelled).toBe(true);
    expect(receipt.stages[0]?.timedOut).toBe(false);
    expect(receipt.stages[0]?.exitCode).not.toBe(0);
    expect(await readFile(receipt.stages[0]!.stdoutPath, 'utf8')).toContain('started');
    expect(JSON.parse(await readFile(receipt.evidencePath, 'utf8'))).toEqual(receipt);
  });

  it('records a pre-aborted verification without starting any stage', async () => {
    const f = await fixture();
    const artifact = await f.seal([stage('never_started', "throw new Error('must not run')")]);
    const controller = new AbortController();
    controller.abort(new Error('stopped before admission'));
    const receipt = await runArtifactVerification({ hostPolicy, repoPath: f.root, artifact,
      evidenceRoot: join(f.root, 'evidence'), currentRequirementsHash: () => requirementsHash, signal: controller.signal });
    expect(receipt.status).toBe('cancelled');
    expect(receipt.stages).toHaveLength(0);
    expect(receipt.failure).toBe('stopped before admission');
  });

  it('records spawn failures instead of losing the receipt', async () => {
    const f = await fixture();
    const receipt = await f.run([{ id: 'missing', command: ['nonexistent-verifier-example-test'], scope: '.', timeoutMs: 1000 }]);
    expect(receipt.status).toBe('failed');
    expect(receipt.stages[0]?.exitCode).toBeNull();
    expect(receipt.stages[0]?.failure).toContain('ENOENT');
  });

  it('rejects stale requirements before execution and after a successful command', async () => {
    const f = await fixture();
    const old = await f.run([stage('test', 'process.exit(0)')], () => 'changed');
    expect(old.status).toBe('stale');
    expect(old.stages).toHaveLength(0);
    let calls = 0;
    const receipt = await f.run([stage('first', 'process.exit(0)'), stage('second', 'process.exit(0)')], () => ++calls < 3 ? requirementsHash : 'changed');
    expect(receipt.status).toBe('stale');
    expect(receipt.stages).toHaveLength(1);
    expect(receipt.stages[0]?.exitCode).toBe(0);
  });

  it('rejects source edits even when the verifier exits successfully', async () => {
    const f = await fixture();
    const receipt = await f.run([stage('edit', "require('fs').writeFileSync('source.txt', 'changed')"), stage('later', 'process.exit(0)')]);
    expect(receipt.status).toBe('source_changed');
    expect(receipt.stages).toHaveLength(1);
  });

  it('hashes the requirements and exact stage plan and rejects tampered seals', async () => {
    const f = await fixture();
    const artifact = await f.seal([stage('test', 'process.exit(0)')]);
    const changed = await f.seal([stage('test', 'process.exit(1)')]);
    expect(changed.artifactHash).not.toBe(artifact.artifactHash);
    await expect(runArtifactVerification({ hostPolicy, repoPath: f.root, artifact: { ...artifact, stages: changed.stages }, evidenceRoot: join(f.root, 'evidence'), currentRequirementsHash: () => requirementsHash })).rejects.toThrow('seal mismatch');
    await expect(sealVerificationArtifact({ hostPolicy, repoPath: f.root, sourceRevision: 'HEAD', requirementsHash, stages: artifact.stages })).rejects.toThrow('full committed revision');
  });

  it('refuses to seal dirty, untracked, or mismatched producer revisions', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'new.txt'), 'untracked');
    await expect(f.seal([stage('test', '')])).rejects.toThrow('clean producer');
    await rm(join(f.root, 'new.txt'));
    await writeFile(join(f.root, 'source.txt'), 'dirty');
    await expect(f.seal([stage('test', '')])).rejects.toThrow('clean producer');
    git(f.root, 'add', '.');
    git(f.root, 'commit', '-m', 'test: change producer');
    await expect(f.seal([stage('test', '')])).rejects.toThrow('clean producer');
  });

  it('rejects escaping scopes and unbounded stage budgets', async () => {
    const f = await fixture();
    await expect(f.seal([{ ...stage('escape', ''), scope: '../producer' }])).rejects.toThrow('Scope');
    await expect(f.seal([stage('hang', '', 0)])).rejects.toThrow('timeout');
    await expect(f.seal([stage('duplicate', ''), stage('duplicate', '')])).rejects.toThrow('duplicate');
  });

  it('persists infrastructure failures without executing an invalid scope', async () => {
    const f = await fixture();
    const receipt = await f.run([{ ...stage('missing_scope', "console.log('must not run')"), scope: 'missing-directory' }]);
    expect(receipt.status).toBe('failed');
    expect(receipt.failure).toContain('ENOENT');
    expect(receipt.stages).toHaveLength(0);
    expect(JSON.parse(await readFile(receipt.evidencePath, 'utf8'))).toEqual(receipt);
  });

  it('caps retained evidence and hashes exactly the retained log bytes', async () => {
    const f = await fixture();
    const receipt = await f.run([stage('output', "process.stdout.write('x'.repeat(1100000))")]);
    expect(receipt.status).toBe('passed');
    const result = receipt.stages[0]!;
    expect(result.outputTruncated).toBe(true);
    const stdout = await readFile(result.stdoutPath);
    expect(stdout.length).toBe(1_048_576);
    expect(result.stdoutHash).toBe(createHash('sha256').update(stdout).digest('hex'));
  });

  it('requires trusted host authorization before any native execution or evidence writes', async () => {
    const f = await fixture();
    const artifact = await f.seal([stage('test', 'process.exit(0)')]);
    const denied: VerificationHostPolicy = { authorize: () => { throw new Error('host denied'); } };
    await expect(sealVerificationArtifact({ hostPolicy: denied, repoPath: '/not/an/authorized/repository', sourceRevision: f.revision,
      requirementsHash, stages: artifact.stages })).rejects.toThrow('host denied');
    await expect(runArtifactVerification({ hostPolicy: denied, repoPath: f.root, artifact,
      evidenceRoot: '/not/an/authorized/evidence/path', currentRequirementsHash: () => requirementsHash })).rejects.toThrow('host denied');
  });

  it('records a credential-free parity environment without leaking removed values', () => {
    const env = verificationEnvironment('/isolated/home', { PATH: '/usr/bin', OPENAI_API_KEY: 'never record', HTTPS_PROXY: 'never record proxy', TZ: 'local', TERM: 'xterm', GIT_DIR: '/producer' });
    expect(env.values).toMatchObject({ PATH: '/usr/bin', HOME: '/isolated/home', CI: 'true', TZ: 'UTC', GIT_CONFIG_VALUE_0: 'master' });
    expect(env.removedKeys).toEqual(['GIT_DIR', 'HTTPS_PROXY', 'OPENAI_API_KEY', 'TERM']);
    expect(JSON.stringify(env)).not.toContain('never record');
  });
});
