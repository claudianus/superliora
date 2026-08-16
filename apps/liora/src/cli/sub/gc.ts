import { Command } from 'commander';
import {
  collectStorageGarbage,
  formatBytes,
  type StorageGcReport,
} from '@superliora/sdk';

import { t } from '#/cli/i18n';
import { getDataDir } from '#/utils/paths';

export interface GcCommandDeps {
  readonly homeDir: () => string;
  readonly collect: typeof collectStorageGarbage;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const defaultDeps = (): GcCommandDeps => ({
  homeDir: () => getDataDir(),
  collect: collectStorageGarbage,
  stdout: (line) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line) => {
    process.stderr.write(`${line}\n`);
  },
});

function printReport(report: StorageGcReport, stdout: (line: string) => void): void {
  stdout(`home: ${report.homeDir}`);
  stdout(`mode: ${report.dryRun ? 'dry-run' : 'apply'}`);
  stdout(
    `compressed=${report.compressed} deleted=${report.deleted} skipped=${report.skipped} freed=${formatBytes(report.freedBytes)}`,
  );
  for (const item of report.items) {
    const bytes = item.bytes !== undefined ? ` ${formatBytes(item.bytes)}` : '';
    stdout(`  [${item.action}/${item.kind}]${bytes} ${item.path}`);
  }
}

export function registerGcCommand(parent: Command, deps?: Partial<GcCommandDeps>): void {
  const d = { ...defaultDeps(), ...deps };
  parent
    .command('gc')
    .description(t('cli.sub.gc.description'))
    .option('--dry-run', t('cli.sub.gc.option.dryRun'), false)
    .option('--idle-days <n>', t('cli.sub.gc.option.idleDays'), '7')
    .action(async (opts: { dryRun?: boolean; idleDays?: string }) => {
      const idleDays = Number.parseInt(opts.idleDays ?? '7', 10);
      const idleMs = (Number.isFinite(idleDays) ? idleDays : 7) * 24 * 60 * 60 * 1000;
      try {
        const report = await d.collect({
          homeDir: d.homeDir(),
          dryRun: opts.dryRun === true,
          idleMs,
        });
        printReport(report, d.stdout);
      } catch (error) {
        d.stderr(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
