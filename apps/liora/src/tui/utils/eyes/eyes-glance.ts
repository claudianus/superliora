/**
 * Eyes readiness settings glance — browser-use / computer-use runtimes (SSOT §9.2).
 */

import type {
  HarnessEyeLine,
  HarnessEyesReadinessReport,
} from '#/tui/utils/harness-eyes-readiness';

export interface EyesSettingsGlance {
  readonly report: HarnessEyesReadinessReport;
  readonly loadError?: string;
}

export function loadEyesSettingsGlance(input: {
  readonly report?: HarnessEyesReadinessReport;
  readonly loadError?: string;
}): EyesSettingsGlance {
  return {
    report: input.report ?? { generatedAt: '', lines: [] },
    loadError: input.loadError,
  };
}

function formatEyeStatusLine(line: HarnessEyeLine): string {
  const mark = line.ok ? 'OK' : 'MISSING';
  return `${line.title}: ${mark} — ${line.detail}`;
}

export function buildEyesSettingsLines(glance: EyesSettingsGlance): readonly string[] {
  const statusLines =
    glance.loadError !== undefined
      ? [`Load error: ${glance.loadError}`]
      : glance.report.lines.flatMap((line) => [
          formatEyeStatusLine(line),
          `  → ${line.hint}`,
        ]);

  const checkedLine =
    glance.loadError === undefined && glance.report.generatedAt.length > 0
      ? `Checked: ${glance.report.generatedAt}`
      : undefined;

  return [
    '── Eyes readiness (read-only) ───────────────',
    'Browser-use / computer-use runtimes — §9.2.',
    '',
    '── Status (live) ────────────────────────────',
    ...(checkedLine !== undefined ? [checkedLine] : []),
    ...statusLines,
    '',
    '── Agent tools (when wired) ─────────────────',
    '· BrowserStatus / VerifySurface — browser-use session tools',
    '· ComputerCapture / ComputerAct — computer-use session tools',
    '',
    '── Doctor / install ─────────────────────────',
    '  liora browser-use doctor        runtime probe',
    '  liora browser-use install       fetch browser-use stack',
    '  liora computer-use doctor       cua-driver probe',
    '  liora computer-use install      install + OS permissions',
    '',
    '── Tips ─────────────────────────────────────',
    '· /eyes or Settings → Eyes readiness — same live report',
    '· Settings → Harness also links here for eyes/hands surface',
    '· Missing runtimes do not block text-only agent work',
  ];
}
