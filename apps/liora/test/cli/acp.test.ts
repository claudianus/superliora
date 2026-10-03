import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@superliora/acp-adapter', () => ({
  ACP_BUILTIN_SLASH_COMMANDS: [
    { name: 'compact', description: 'Compact the session context' },
  ],
  runAcpServer: vi.fn(async () => undefined),
}));

import { runAcpServer } from '@superliora/acp-adapter';


class ExitCalled extends Error {
  constructor(public code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

describe('liora acp', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(runAcpServer).mockClear();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
      throw new ExitCalled(code);
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });


  it('exits without starting the ACP server when --login is passed', async () => {
    // Stub the harness module so runLoginFlow doesn't hit a real OAuth
    // endpoint: harness.auth.login resolves immediately and triggers exit 0.
    // `importOriginal` preserves the other named exports (`ErrorCodes`, etc.)
    // that constant/app.ts depends on at module load.
    const loginStub = vi.fn(async () => ({ providerName: 'kimi-code' }));
    vi.doMock(import('@superliora/sdk'), async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        createLioraHarness: () =>
          ({
            auth: { login: loginStub },
          }) as unknown as ReturnType<typeof actual.createLioraHarness>,
      };
    });
    vi.resetModules();
    const { registerAcpCommand: freshRegister } = await import('#/cli/sub/acp');
    try {
      const program = new Command('kimi').exitOverride();
      freshRegister(program);

      await expect(program.parseAsync(['node', 'kimi', 'acp', '--login'])).rejects.toThrow(
        ExitCalled,
      );

      expect(loginStub).toHaveBeenCalledTimes(1);
      expect(runAcpServer).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      vi.doUnmock('@superliora/sdk');
      vi.resetModules();
    }
  });
});
