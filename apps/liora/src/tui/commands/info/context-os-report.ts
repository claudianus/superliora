import type { ContextOSRetrievalDiagnostics } from '@superliora/sdk';
import {
  formatContextOSDiagnoseLine,
  formatContextOSHealthLine,
  loadRuntimeConfigSafe,
  resolveConfigPath,
  resolveLioraHome,
} from '@superliora/sdk';

import type { SlashCommandHost } from '../hub/dispatch';

export function loadPrivacySnapshot(host: SlashCommandHost): {
  readonly telemetryEnabled: boolean;
  readonly configPath: string;
} {
  try {
    const homeDir = host.harness.homeDir ?? resolveLioraHome();
    const configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });
    const { config } = loadRuntimeConfigSafe(configPath);
    return {
      telemetryEnabled: config.telemetry === true,
      configPath,
    };
  } catch {
    return {
      telemetryEnabled: false,
      configPath: '(unknown)',
    };
  }
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function imageProviderKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    nonEmptyEnv(env['OPENAI_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GEMINI_API_KEY']) !== undefined
  );
}

function videoProviderKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    nonEmptyEnv(env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GEMINI_API_KEY']) !== undefined
  );
}

function formatMediaReadinessLines(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const imageReady = imageProviderKeyReady(env);
  const videoReady = videoProviderKeyReady(env);
  return [
    'Media & research (zero-config when keys already exist)',
    '  Web: multi-provider WebSearch (Brave/Tavily/Exa/Serper env keys + free DuckDuckGo) + FetchURL.',
    '  Docs: Context7Resolve → Context7Docs for library APIs (built-in).',
    imageReady
      ? '  Images: ready · GenerateImage (OPENAI/GOOGLE/GEMINI key detected).'
      : '  Images: set OPENAI_API_KEY or GOOGLE_API_KEY/GEMINI_API_KEY to enable GenerateImage.',
    videoReady
      ? '  Video: ready · GenerateVideo (GOOGLE/GEMINI key detected).'
      : '  Video: set GOOGLE_API_KEY/GEMINI_API_KEY to enable GenerateVideo.',
    '  Office: SearchSkill → docx / pptx / xlsx (Word, slides, sheets · zero MCP).',
  ];
}

export function buildContextOsReportLines(
  diagnostics: ContextOSRetrievalDiagnostics,
  privacy: { readonly telemetryEnabled: boolean; readonly configPath: string },
  query: string,
): string[] {
  const health = diagnostics.health;
  const lines = [
    formatContextOSDiagnoseLine(diagnostics),
    '',
    `Query: ${query.length > 0 ? query : '(default: current work)'}`,
    `Health: ${formatContextOSHealthLine(health)}`,
    `Pages: ${String(health.pageCount)} · ready ${String(health.readyPageCount)} · rehydrate ${String(health.needsRehydrationPageCount)} · at-risk ${String(health.atRiskPageCount)}`,
    `Evidence: score ${health.evidenceIdRecallScore.toFixed(2)} · missing pages ${String(health.missingEvidencePageCount)}`,
    `Selection: candidates ${String(diagnostics.candidatePageCount)} · selected ${String(diagnostics.selectedPageCount)} · superseded ${String(diagnostics.supersededPageCount)}`,
    `Reasons: ${diagnostics.selectedReasons.length > 0 ? diagnostics.selectedReasons.join(', ') : 'none'}`,
  ];
  if (diagnostics.selectedPageSequences.length > 0) {
    lines.push(
      `Selected pages: ${diagnostics.selectedPageSequences.map(String).join(', ')}`,
    );
  }
  lines.push(
    '',
    'Privacy / ZDR posture',
    `  Telemetry: ${privacy.telemetryEnabled ? 'ON (opt-in)' : 'OFF (default · ZDR-friendly)'}`,
    `  Config: ${privacy.configPath}`,
    '  Tip: product telemetry is off by default. Set `telemetry = true` in config.toml only if you want usage analytics.',
    '  Session transcripts still stay local to this machine unless you export them.',
    '',
    ...formatMediaReadinessLines(),
  );
  return lines;
}
