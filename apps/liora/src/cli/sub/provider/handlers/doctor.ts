/**
 * `liora provider doctor` handler — configuration health diagnostics.
 */

import { t } from '#/cli/i18n';
import type { LioraConfig } from '@superliora/sdk';

import {
  hasVertexAIServiceAccountSource,
  isValidCredentialLabel,
  providerCredentialSources,
  providerEnvReferences,
  providerHasApiKeySource,
  providerHasOAuth,
  providerOAuthRefs,
} from '../credential';
import { buildRoutePreview, routeCandidateCredentialLabels } from '../route-utils';
import {
  doctorErrorWord,
  doctorWarningWord,
  errorMessage,
  isHttpUrl,
  nonEmptyString,
  parseEnvReference,
  writeProviderErr,
} from '../shared';
import type {
  ConfigModelAlias,
  DoctorOptions,
  ProviderDeps,
  ProviderDoctorIssue,
  ProviderDoctorReport,
} from '../types';

export async function handleProviderDoctor(
  deps: ProviderDeps,
  opts: DoctorOptions,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const report = buildProviderDoctorReport(config, deps.env);

  if (opts.json) {
    deps.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    deps.stdout.write(formatProviderDoctorReport(report));
  }

  if (report.errorCount > 0) {
    deps.exit(1);
  }
}

export function buildProviderDoctorReport(
  config: LioraConfig,
  env: NodeJS.ProcessEnv,
): ProviderDoctorReport {
  const issues: ProviderDoctorIssue[] = [];
  const providers = config.providers;
  const models = config.models ?? {};
  let routeCount = 0;
  let candidateCount = 0;

  if (Object.keys(providers).length === 0) {
    addDoctorIssue(issues, {
      level: 'warning',
      code: 'no_providers',
      message: t('cli.runtime.provider.doctor.noProviders'),
    });
  }
  if (Object.keys(models).length === 0) {
    addDoctorIssue(issues, {
      level: 'warning',
      code: 'no_models',
      message: t('cli.runtime.provider.doctor.noModels'),
    });
  }
  if (config.defaultModel !== undefined && models[config.defaultModel] === undefined) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_default_model',
      message: t('cli.runtime.provider.doctor.missingDefaultModel', { alias: config.defaultModel }),
      modelAlias: config.defaultModel,
    });
  }

  for (const providerId of Object.keys(providers).toSorted()) {
    const provider = providers[providerId]!;
    collectProviderDoctorIssues(issues, providerId, provider, env);
  }

  for (const modelAlias of Object.keys(models).toSorted()) {
    const model = models[modelAlias]!;
    collectModelDoctorIssues(issues, modelAlias, model, config);
    try {
      const preview = buildRoutePreview(config, modelAlias);
      if (preview.active) {
        routeCount += 1;
        candidateCount += preview.candidates.length;
      }
    } catch (error) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_route',
        message: errorMessage(error),
        modelAlias,
      });
    }
  }

  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const warningCount = issues.length - errorCount;
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    providerCount: Object.keys(providers).length,
    modelCount: Object.keys(models).length,
    routeCount,
    candidateCount,
    issues,
  };
}

function collectProviderDoctorIssues(
  issues: ProviderDoctorIssue[],
  providerId: string,
  provider: LioraConfig['providers'][string],
  env: NodeJS.ProcessEnv,
): void {
  const hasApiKey = providerHasApiKeySource(provider);
  const hasOAuth = providerHasOAuth(provider);
  const hasServiceAccount = hasVertexAIServiceAccountSource(provider);
  const hasAuth =
    hasApiKey ||
    hasOAuth ||
    hasServiceAccount ||
    providerCredentialSources(provider).some((source) => source.auth === 'keyless');

  if (!hasAuth) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_auth',
      message: t('cli.runtime.provider.doctor.missingAuth'),
      providerId,
    });
  }

  if (hasApiKey && hasOAuth) {
    addDoctorIssue(issues, {
      level: 'warning',
      code: 'mixed_auth',
      message: t('cli.runtime.provider.doctor.mixedAuth'),
      providerId,
    });
  }

  for (const ref of providerEnvReferences(provider)) {
    if (nonEmptyString(env[ref.envVar]) === undefined) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'missing_env',
        message: t('cli.runtime.provider.doctor.missingEnv', {
          envVar: ref.envVar,
          source: ref.source,
        }),
        providerId,
        envVar: ref.envVar,
      });
    }
  }

  collectProviderCredentialDoctorIssues(issues, providerId, provider);
  collectProviderOAuthDoctorIssues(issues, providerId, provider);
}

function collectProviderCredentialDoctorIssues(
  issues: ProviderDoctorIssue[],
  providerId: string,
  provider: LioraConfig['providers'][string],
): void {
  const seen = new Set<string>();
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const credential = provider.credentials?.[index];
    if (credential === undefined) continue;
    const source = `credentials[${String(index + 1)}]`;
    const apiKey = nonEmptyString(credential.apiKey);
    if (apiKey === undefined) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'empty_credential_api_key',
        message: t('cli.runtime.provider.doctor.emptyCredentialApiKey', { source }),
        providerId,
      });
      continue;
    }
    const label = nonEmptyString(credential.label);
    if (label !== undefined && !isValidCredentialLabel(label)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_credential_label',
        message: t('cli.runtime.provider.doctor.invalidCredentialLabel', { source }),
        providerId,
      });
    }
    const baseUrl = nonEmptyString(credential.baseUrl);
    if (baseUrl !== undefined && parseEnvReference(baseUrl) === undefined && !isHttpUrl(baseUrl)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_credential_base_url',
        message: t('cli.runtime.provider.doctor.invalidCredentialBaseUrl', { source }),
        providerId,
      });
    }
    const key = `${apiKey}\n${baseUrl ?? ''}`;
    if (seen.has(key)) {
      addDoctorIssue(issues, {
        level: 'warning',
        code: 'duplicate_credential',
        message: t('cli.runtime.provider.doctor.duplicateCredential', { source }),
        providerId,
      });
    }
    seen.add(key);
  }
  const seenLabels = new Set<string>();
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const label = nonEmptyString(provider.credentials?.[index]?.label);
    if (label === undefined) continue;
    const normalized = label.toLowerCase();
    if (seenLabels.has(normalized)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'duplicate_credential_label',
        message: t('cli.runtime.provider.doctor.duplicateCredentialLabel', {
          index: String(index + 1),
        }),
        providerId,
      });
    }
    seenLabels.add(normalized);
  }
}

function collectProviderOAuthDoctorIssues(
  issues: ProviderDoctorIssue[],
  providerId: string,
  provider: LioraConfig['providers'][string],
): void {
  const refs = providerOAuthRefs(provider);
  const seenLabels = new Set<string>();
  for (let index = 0; index < refs.length; index += 1) {
    const label = nonEmptyString(refs[index]?.label);
    if (label === undefined) continue;
    if (!isValidCredentialLabel(label)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_oauth_label',
        message: t('cli.runtime.provider.doctor.invalidOAuthLabel', { index: String(index + 1) }),
        providerId,
      });
    }
    const normalized = label.toLowerCase();
    if (seenLabels.has(normalized)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'duplicate_oauth_label',
        message: t('cli.runtime.provider.doctor.duplicateOAuthLabel', { index: String(index + 1) }),
        providerId,
      });
    }
    seenLabels.add(normalized);
  }
}

function collectModelDoctorIssues(
  issues: ProviderDoctorIssue[],
  modelAlias: string,
  model: ConfigModelAlias,
  config: LioraConfig,
): void {
  const providerName = model.provider ?? config.defaultProvider;
  if (providerName === undefined) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_model_provider',
      message: t('cli.runtime.provider.doctor.missingModelProvider'),
      modelAlias,
    });
  } else if (config.providers[providerName] === undefined) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_model_provider',
      message: t('cli.runtime.provider.doctor.missingModelProviderName', { providerName }),
      modelAlias,
    });
  }

  for (const fallbackAlias of model.fallbackModels ?? []) {
    if (fallbackAlias === modelAlias) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'self_fallback_model',
        message: t('cli.runtime.provider.doctor.selfFallback'),
        modelAlias,
      });
    } else if (config.models?.[fallbackAlias] === undefined) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'missing_fallback_model',
        message: t('cli.runtime.provider.doctor.missingFallbackModel', { fallback: fallbackAlias }),
        modelAlias,
      });
    }
  }

  const routeAliases = new Set([modelAlias, ...(model.fallbackModels ?? [])]);
  for (const weightAlias of Object.keys(model.routing?.weights ?? {})) {
    if (!routeAliases.has(weightAlias)) {
      addDoctorIssue(issues, {
        level: 'warning',
        code: 'unused_route_weight',
        message: t('cli.runtime.provider.doctor.unusedRouteWeight', { weightAlias }),
        modelAlias,
      });
    }
  }

  const preferredCredential = model.routing?.preferredCredential;
  if (preferredCredential !== undefined) {
    let labels: string[];
    try {
      labels = routeCandidateCredentialLabels(config, modelAlias, model.fallbackModels ?? []);
    } catch {
      return;
    }
    if (!labels.includes(preferredCredential)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_preferred_credential',
        message: t('cli.runtime.provider.doctor.invalidPreferredCredential', {
          credential: preferredCredential,
        }),
        modelAlias,
      });
    }
  }
}

function addDoctorIssue(
  issues: ProviderDoctorIssue[],
  issue: ProviderDoctorIssue,
): void {
  issues.push(issue);
}

export function formatProviderDoctorReport(report: ProviderDoctorReport): string {
  const lines =
    report.issues.length === 0
      ? [
          t('cli.runtime.provider.doctor.ok', {
            providerCount: String(report.providerCount),
            modelCount: String(report.modelCount),
            routeCount: String(report.routeCount),
            candidateCount: String(report.candidateCount),
          }),
        ]
      : [
          t('cli.runtime.provider.doctor.summary', {
            errorCount: String(report.errorCount),
            errorWord: doctorErrorWord(report.errorCount),
            warningCount: String(report.warningCount),
            warningWord: doctorWarningWord(report.warningCount),
          }),
          ...report.issues.map(formatProviderDoctorIssue),
        ];
  return `${lines.join('\n')}\n`;
}

function formatProviderDoctorIssue(issue: ProviderDoctorIssue): string {
  const scope = [
    issue.providerId === undefined
      ? undefined
      : t('cli.runtime.provider.doctor.scopeProvider', { providerId: issue.providerId }),
    issue.modelAlias === undefined
      ? undefined
      : t('cli.runtime.provider.doctor.scopeModel', { modelAlias: issue.modelAlias }),
    issue.envVar === undefined
      ? undefined
      : t('cli.runtime.provider.doctor.scopeEnv', { envVar: issue.envVar }),
  ].filter((part): part is string => part !== undefined);
  const scopeText = scope.length === 0 ? '' : scope.join('');
  return t('cli.runtime.provider.doctor.issueLine', {
    level: issue.level,
    code: issue.code,
    scope: scopeText,
    message: issue.message,
  });
}
