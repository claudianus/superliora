import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LioraCore } from '../../src/rpc/core-impl';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeHome(configToml?: string): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
  tempDirs.push(home);
  if (configToml !== undefined) {
    await writeFile(path.join(home, 'config.toml'), configToml, 'utf-8');
  }
  return home;
}

function makeCore(home: string): LioraCore {
  return new LioraCore(async () => ({}) as never, { homeDir: home });
}

const VALID_TOML = `
default_model = "k2"

[providers.kimi]
type = "kimi"
api_key = "sk-good"

[models.k2]
provider = "kimi"
model = "kimi-for-coding"
max_context_size = 128000
`;

describe('LioraCore degraded config loading', () => {
  it('reports no diagnostics for a valid config', async () => {
    const core = makeCore(await makeHome(VALID_TOML));
    const config = await core.getKimiConfig({});
    expect(config.providers['kimi']).toBeDefined();
    await expect(core.getConfigDiagnostics({})).resolves.toEqual({ warnings: [] });
  });

  it('refuses to start when the TOML cannot be parsed at all', async () => {
    const home = await makeHome('[[[');
    // A fully unusable file means defaults-only (looks logged out), which is
    // worse than failing fast with the parse location.
    expect(() => makeCore(home)).toThrow(/Invalid TOML/);
  });

  it('starts with a partially invalid config, keeping the valid sections', async () => {
    const core = makeCore(
      await makeHome(`${VALID_TOML}
[loop_control]
max_steps_per_turn = "nope"
`),
    );
    const config = await core.getKimiConfig({});
    expect(config.providers['kimi']).toBeDefined();
    expect(config.loopControl).toBeUndefined();
    const diagnostics = await core.getConfigDiagnostics({});
    expect(diagnostics.warnings).toHaveLength(1);
    expect(diagnostics.warnings[0]).toContain('loop_control');
  });

  it('rejects config writes with an actionable error while the file is invalid', async () => {
    const home = await makeHome(`${VALID_TOML}
[loop_control]
max_steps_per_turn = "nope"
`);
    const core = makeCore(home);
    const before = await readFile(path.join(home, 'config.toml'), 'utf-8');

    // Write paths stay strict: changing settings on top of a broken file
    // must fail with a short, actionable message — not raw validation JSON —
    // and must leave the file untouched.
    const write = core.setKimiConfig({ defaultThinking: true });
    await expect(write).rejects.toThrow(/fix it first/i);
    await expect(write).rejects.toThrow(/liora doctor/);
    await expect(write).rejects.not.toThrow(/invalid_type/);

    const after = await readFile(path.join(home, 'config.toml'), 'utf-8');
    expect(after).toBe(before);
  });

  it('keeps the last good config when the file breaks mid-run', async () => {
    const home = await makeHome(VALID_TOML);
    const core = makeCore(home);
    const configPath = path.join(home, 'config.toml');

    await writeFile(configPath, '[[[', 'utf-8');
    const kept = await core.getKimiConfig({ reload: true });
    expect(kept.providers['kimi']).toBeDefined();
    const degraded = await core.getConfigDiagnostics({});
    expect(degraded.warnings.some((w) => w.includes('Invalid TOML'))).toBe(true);
    expect(degraded.warnings.some((w) => w.includes('previous'))).toBe(true);

    await writeFile(configPath, `default_thinking = true\n${VALID_TOML}`, 'utf-8');
    const adopted = await core.getKimiConfig({ reload: true });
    expect(adopted.defaultThinking).toBe(true);
    await expect(core.getConfigDiagnostics({})).resolves.toEqual({ warnings: [] });
  });
});

describe('LioraCore config field deletion', () => {
  const ROUTING_MODELS_TOML = `${VALID_TOML}
[loop_control]
max_steps_per_turn = 7
compaction_model = "compact"
completion_model = "complete"
exploration_model = "explore"
coding_model = "code"
planning_model = "plan"
debugging_model = "debug"
`;

  it('deletes nested routing fields, persists them, and reloads the runtime config', async () => {
    const home = await makeHome(ROUTING_MODELS_TOML);
    const configPath = path.join(home, 'config.toml');
    const core = makeCore(home);
    const before = await core.getKimiConfig({});

    const deleted = await core.deleteConfigFields({
      paths: ['loopControl.compactionModel', 'loopControl.completionModel'],
    });

    expect(deleted).not.toBe(before);
    expect(deleted.loopControl).toMatchObject({
      maxStepsPerTurn: 7,
      explorationModel: 'explore',
      codingModel: 'code',
      planningModel: 'plan',
      debuggingModel: 'debug',
    });
    expect(deleted.loopControl).not.toHaveProperty('compactionModel');
    expect(deleted.loopControl).not.toHaveProperty('completionModel');

    const persisted = await readFile(configPath, 'utf-8');
    expect(persisted).not.toContain('compaction_model');
    expect(persisted).not.toContain('completion_model');

    const reloaded = await core.getKimiConfig({ reload: true });
    expect(reloaded.loopControl).not.toHaveProperty('compactionModel');
    expect(reloaded.loopControl).not.toHaveProperty('completionModel');
    expect(reloaded.loopControl?.explorationModel).toBe('explore');
  });

  it('rejects invalid batches without changing config', async () => {
    const home = await makeHome(ROUTING_MODELS_TOML);
    const configPath = path.join(home, 'config.toml');
    const core = makeCore(home);
    const before = await readFile(configPath, 'utf-8');
    const invalidPaths = [
      ['loopControl.compactionModel', 'loopControl.__proto__'],
      ['loopControl.constructor'],
      ['loopControl..compactionModel'],
      [['loopControl', 'compactionModel']],
      ['loopControl.maxStepsPerTurn'],
    ];

    for (const paths of invalidPaths) {
      await expect(core.deleteConfigFields({ paths } as never)).rejects.toMatchObject({
        code: 'config.invalid',
      });
      await expect(readFile(configPath, 'utf-8')).resolves.toBe(before);
    }

    const unchanged = await core.getKimiConfig({});
    expect(unchanged.loopControl?.compactionModel).toBe('compact');
  });

  it('returns a reloaded snapshot when an allowed field is already absent', async () => {
    const home = await makeHome(ROUTING_MODELS_TOML.replace('completion_model = "complete"\n', ''));
    const configPath = path.join(home, 'config.toml');
    const core = makeCore(home);
    const before = await core.getKimiConfig({});
    const beforeText = await readFile(configPath, 'utf-8');

    const result = await core.deleteConfigFields({ paths: ['loopControl.completionModel'] });

    expect(result).not.toBe(before);
    expect(result.loopControl?.compactionModel).toBe('compact');
    await expect(readFile(configPath, 'utf-8')).resolves.toBe(beforeText);
  });
});
