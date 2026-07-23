/**
 * Localized runtime strings for `liora provider` command output (stdout/stderr,
 * doctor reports, route previews, validation errors). English values are
 * byte-identical to the previous hardcoded strings.
 */

export const STRINGS_RUNTIME_PROVIDER_EN: Readonly<Record<string, string>> = {
  // add / registry
  'cli.runtime.provider.missingRegistryApiKey':
    'Missing API key. Pass --api-key <key> or set KIMI_REGISTRY_API_KEY.',
  'cli.runtime.provider.registryUrlRequired': 'Registry URL is required.',
  'cli.runtime.provider.fetchRegistryFailed': 'Failed to fetch registry{suffix}: {error}',
  'cli.runtime.provider.registryEmpty': 'Registry at {url} contained no usable providers.',
  'cli.runtime.provider.importedHeader':
    'Imported {count} {providerUnit} ({modelCount} {modelUnit}) from {url}:',
  'cli.runtime.provider.importedItem': '  - {id}',

  // remove / list
  'cli.runtime.provider.notFound': 'Provider "{providerId}" not found.',
  'cli.runtime.provider.removed': 'Removed provider "{providerId}".',
  'cli.runtime.provider.noProvidersConfigured': 'No providers configured.',
  'cli.runtime.provider.listLine':
    '{id}  type={type}  models={modelCount}  keys={keyCount}  source={source}',
  'cli.runtime.provider.listAliases': '  aliases: {aliases}',
  'cli.runtime.provider.listDefaultModel': '\nDefault model: {label}',

  // use
  'cli.runtime.provider.modelAliasRequired': 'Model alias is required.',
  'cli.runtime.provider.modelNotFoundListHint':
    'Model "{alias}" not found. Run `liora provider list --json` to see configured model aliases.',
  'cli.runtime.provider.modelMissingProvider':
    'Model "{alias}" points at missing provider "{provider}". Run `liora provider` to inspect configured providers.',
  'cli.runtime.provider.defaultModelSet': 'Default model set to {label}.',

  // custom add
  'cli.runtime.provider.missingBaseUrl': 'Missing base URL. Pass --base-url <url>.',
  'cli.runtime.provider.missingModelId': 'Missing model id. Pass --model <modelId>.',
  'cli.runtime.provider.missingCustomApiKey':
    'Missing API key. Pass --api-key <key>, --api-key-env <name>, set KIMI_PROVIDER_API_KEY, or use --keyless for local endpoints.',
  'cli.runtime.provider.oauthChooseDifferentId':
    'Provider "{providerId}" uses OAuth; choose a different provider id.',
  'cli.runtime.provider.customEndpointAdded':
    'Added custom endpoint provider "{providerId}" with model "{modelAlias}".',
  'cli.runtime.provider.defaultModelSetAlias': 'Default model set to {alias}.',

  // key add / list / remove / promote / label / limit / clear
  'cli.runtime.provider.missingKeyAddApiKey':
    'Missing API key. Pass --api-key <key>, --api-keys <keys>, --api-key-env <name>, --api-key-envs <names>, or set KIMI_PROVIDER_API_KEY.',
  'cli.runtime.provider.oauthApiKeyMixed':
    'Provider "{providerId}" uses OAuth; API keys cannot be mixed into it.',
  'cli.runtime.provider.apiKeyAlreadyConfigured':
    'API {keyWord} already configured for provider "{providerId}".',
  'cli.runtime.provider.apiKeyAdded': 'Added API key to provider "{providerId}".',
  'cli.runtime.provider.apiKeysAdded': 'Added {count} API keys to provider "{providerId}".',
  'cli.runtime.provider.noApiKeys': 'Provider "{providerId}" has no configured API keys.',
  'cli.runtime.provider.apiKeysHeader':
    'Provider "{providerId}" has {count} configured API {keyWord}:',
  'cli.runtime.provider.apiKeyListLine':
    '  #{index}  {role}{labelText}{rpmText}{tpmText}{baseUrlText}',
  'cli.runtime.provider.oauthApiKeyCannotRemove':
    'Provider "{providerId}" uses OAuth; API keys cannot be removed from it.',
  'cli.runtime.provider.apiKeyNotFound':
    'API key #{index} not found for provider "{providerId}". Run `liora provider key list {providerId}`.',
  'cli.runtime.provider.apiKeyRemoved': 'Removed API key #{index} from provider "{providerId}".',
  'cli.runtime.provider.oauthApiKeyCannotPromote':
    'Provider "{providerId}" uses OAuth; API keys cannot be promoted.',
  'cli.runtime.provider.apiKeyAlreadyPrimary': 'API key #1 is already primary for provider "{providerId}".',
  'cli.runtime.provider.apiKeyPromoted':
    'Promoted API key #{index} to primary for provider "{providerId}".',
  'cli.runtime.provider.oauthApiKeyCannotLabel':
    'Provider "{providerId}" uses OAuth; API keys cannot be labeled.',
  'cli.runtime.provider.credentialLabelDuplicate':
    'Credential label "{label}" is already used by another API key.',
  'cli.runtime.provider.apiKeyLabeled':
    'Labeled API key #{index} for provider "{providerId}" as "{label}".',
  'cli.runtime.provider.oauthApiKeyCannotUnlabel':
    'Provider "{providerId}" uses OAuth; API keys cannot be unlabeled.',
  'cli.runtime.provider.apiKeyNoLabel':
    'API key #{index} for provider "{providerId}" has no label.',
  'cli.runtime.provider.apiKeyLabelRemoved':
    'Removed label from API key #{index} for provider "{providerId}".',
  'cli.runtime.provider.keyLimitNothingToUpdate':
    'Nothing to update. Pass --rpm, --tpm, or --clear.',
  'cli.runtime.provider.keyLimitClearOrValues': 'Pass either --clear or limit values, not both.',
  'cli.runtime.provider.oauthApiKeyLimitsCannotChange':
    'Provider "{providerId}" uses OAuth; API key limits cannot be changed.',
  'cli.runtime.provider.keyLimitsCleared':
    'Cleared local limits for API key #{index} on provider "{providerId}".',
  'cli.runtime.provider.keyLimitsUpdated':
    'Updated local limits for API key #{index} on provider "{providerId}".',
  'cli.runtime.provider.allApiKeysRemoved': 'Removed all API keys from provider "{providerId}".',

  // oauth
  'cli.runtime.provider.missingOAuthStorageKey': 'Missing OAuth storage key. Pass --key <key>.',
  'cli.runtime.provider.oauthApiKeyMixedInto':
    'Provider "{providerId}" uses API keys; OAuth accounts cannot be mixed into it.',
  'cli.runtime.provider.oauthRefAlreadyConfigured':
    'OAuth account ref is already configured for provider "{providerId}".',
  'cli.runtime.provider.oauthRefAdded': 'Added OAuth account ref to provider "{providerId}".',
  'cli.runtime.provider.noOAuthRefs':
    'Provider "{providerId}" has no configured OAuth account refs.',
  'cli.runtime.provider.oauthRefsHeader':
    'Provider "{providerId}" has {count} configured OAuth account {refWord}:',
  'cli.runtime.provider.oauthListLine':
    '  #{index}  {role}{labelText}  storage={storage}  host={host}  fingerprint={fingerprint}',
  'cli.runtime.provider.oauthRefNotFound':
    'OAuth account ref #{index} not found for provider "{providerId}". Run `liora provider oauth list {providerId}`.',
  'cli.runtime.provider.oauthRefRemoved':
    'Removed OAuth account ref #{index} from provider "{providerId}".',
  'cli.runtime.provider.oauthApiKeyCannotPromoteOAuth':
    'Provider "{providerId}" uses API keys; OAuth accounts cannot be promoted.',
  'cli.runtime.provider.oauthRefAlreadyPrimary':
    'OAuth account ref #1 is already primary for provider "{providerId}".',
  'cli.runtime.provider.oauthRefPromoted':
    'Promoted OAuth account ref #{index} to primary for provider "{providerId}".',
  'cli.runtime.provider.oauthApiKeyCannotLabelOAuth':
    'Provider "{providerId}" uses API keys; OAuth account refs cannot be labeled.',
  'cli.runtime.provider.oauthLabelDuplicate':
    'OAuth label "{label}" is already used by another account ref.',
  'cli.runtime.provider.oauthRefLabeled':
    'Labeled OAuth account ref #{index} for provider "{providerId}" as "{label}".',
  'cli.runtime.provider.oauthApiKeyCannotUnlabelOAuth':
    'Provider "{providerId}" uses API keys; OAuth account refs cannot be unlabeled.',
  'cli.runtime.provider.oauthRefNoLabel':
    'OAuth account ref #{index} for provider "{providerId}" has no label.',
  'cli.runtime.provider.oauthRefLabelRemoved':
    'Removed label from OAuth account ref #{index} for provider "{providerId}".',
  'cli.runtime.provider.allOAuthRefsRemoved':
    'Removed all OAuth account refs from provider "{providerId}".',

  // route show / set / auto / reset / status
  'cli.runtime.provider.modelNotFound': 'Model "{modelAlias}" not found.',
  'cli.runtime.provider.routeShowHeader': 'Route for {modelAlias}:',
  'cli.runtime.provider.routeShowProvider': '  provider: {provider}',
  'cli.runtime.provider.routeShowModel': '  model: {model}',
  'cli.runtime.provider.routeShowFallbackModels': '  fallback_models: {fallbacks}',
  'cli.runtime.provider.routeShowStrategy': '  strategy: {strategy}',
  'cli.runtime.provider.routeShowWeights': '  weights: {weights}',
  'cli.runtime.provider.routeShowSessionAffinity': '  session_affinity: {value}',
  'cli.runtime.provider.routeShowPreferredCredential': '  preferred_credential: {value}',
  'cli.runtime.provider.routeShowCooldownMs': '  cooldown_ms: {value}',
  'cli.runtime.provider.routeSetNothingToUpdate':
    'Nothing to update. Pass --fallback, --strategy, --cooldown-ms, --weights, --session-affinity, or --prefer-credential.',
  'cli.runtime.provider.fallbackModelNotConfigured': 'Fallback model "{fallback}" is not configured.',
  'cli.runtime.provider.selfFallback': 'A model cannot list itself as a fallback.',
  'cli.runtime.provider.routeUpdated': 'Updated route for model "{modelAlias}".',
  'cli.runtime.provider.autoRouteNeedsCandidates':
    'Auto route for model "{modelAlias}" needs at least two candidates. Add another API key/OAuth account or pass --fallback <alias>.',
  'cli.runtime.provider.autoRouteEnabled':
    'Enabled auto route for model "{modelAlias}" with {count} candidates.',
  'cli.runtime.provider.routeResetNone':
    'No provider route health to reset for session "{sessionId}".',
  'cli.runtime.provider.routeResetDone':
    'Reset provider route health for "{modelAlias}" in session "{sessionId}" ({count} candidates).',
  'cli.runtime.provider.routeStatusNone': 'No provider route health for session "{sessionId}".',

  // route preview / health formatting
  'cli.runtime.provider.valueNone': '(none)',
  'cli.runtime.provider.valueAuto': '(auto)',
  'cli.runtime.provider.valueDefault': '(default)',
  'cli.runtime.provider.valueOn': 'on',
  'cli.runtime.provider.valueOff': 'off',
  'cli.runtime.provider.valueYes': 'yes',
  'cli.runtime.provider.valueNo': 'no',
  'cli.runtime.provider.rolePrimary': 'primary',
  'cli.runtime.provider.roleFallback': 'fallback',
  'cli.runtime.provider.routePreviewHeader': 'Route preview for {modelAlias}:',
  'cli.runtime.provider.routePreviewActive': '  active: {value}',
  'cli.runtime.provider.routePreviewStrategy': '  strategy: {strategy}',
  'cli.runtime.provider.routePreviewFallbackModels': '  fallback_models: {fallbacks}',
  'cli.runtime.provider.routePreviewSessionAffinity': '  session_affinity: {value}',
  'cli.runtime.provider.routePreviewPreferredCredential': '  preferred_credential: {value}',
  'cli.runtime.provider.routePreviewCandidatesLabel': '  candidates:',
  'cli.runtime.provider.routeHealthHeader':
    'Route health for {modelAlias} (strategy={strategy}{affinityText}{preferredText}):',
  'cli.runtime.provider.routeHealthAffinityOn': ', affinity=on',
  'cli.runtime.provider.routeHealthPreferred': ', preferred={credential}',
  'cli.runtime.provider.routeHealthCooling': 'cooling {duration}',
  'cli.runtime.provider.routeHealthReady': 'ready',

  // auto-route summary
  'cli.runtime.provider.autoRouteNoCandidates':
    'No model aliases for provider "{providerId}" had enough route candidates to auto-route.',
  'cli.runtime.provider.autoRouteEnabledSummary':
    'Enabled auto route for {count} model {aliasWord}: {aliases}.',

  // buildRoutePreview throws (no trailing newline — passed through errorMessage)
  'cli.runtime.provider.modelNotFoundThrow': 'Model "{modelAlias}" not found.',
  'cli.runtime.provider.fallbackModelNotConfiguredThrow':
    'Fallback model "{modelAlias}" is not configured.',
  'cli.runtime.provider.modelMustDefineProvider': 'Model "{modelAlias}" must define a provider.',
  'cli.runtime.provider.providerNotConfiguredForModel':
    'Provider "{providerName}" for model "{modelAlias}" is not configured.',

  // doctor report
  'cli.runtime.provider.doctor.ok':
    'Provider doctor: ok (providers={providerCount}, models={modelCount}, routes={routeCount}, candidates={candidateCount})',
  'cli.runtime.provider.doctor.summary':
    'Provider doctor: {errorCount} {errorWord}, {warningCount} {warningWord}',
  'cli.runtime.provider.doctor.issueLine': '  [{level}] {code}{scope}: {message}',
  'cli.runtime.provider.doctor.noProviders': 'No providers are configured.',
  'cli.runtime.provider.doctor.noModels': 'No model aliases are configured.',
  'cli.runtime.provider.doctor.missingDefaultModel':
    'Default model "{alias}" is not configured.',
  'cli.runtime.provider.doctor.missingAuth':
    'Provider has no API key, OAuth account, keyless marker, or supported service account source.',
  'cli.runtime.provider.doctor.mixedAuth':
    'Provider has both API key sources and OAuth refs; API key sources take precedence.',
  'cli.runtime.provider.doctor.missingEnv':
    'Environment variable "{envVar}" is referenced by {source} but is not set.',
  'cli.runtime.provider.doctor.emptyCredentialApiKey': '{source} has an empty api_key.',
  'cli.runtime.provider.doctor.invalidCredentialLabel':
    '{source} label must use only letters, numbers, dot, underscore, or dash.',
  'cli.runtime.provider.doctor.invalidCredentialBaseUrl':
    '{source} base_url must start with http:// or https://.',
  'cli.runtime.provider.doctor.duplicateCredential':
    '{source} duplicates an earlier API key/base_url slot and will be ignored.',
  'cli.runtime.provider.doctor.duplicateCredentialLabel':
    'credentials[{index}] label duplicates an earlier credential label.',
  'cli.runtime.provider.doctor.invalidOAuthLabel':
    'OAuth account ref #{index} label must use only letters, numbers, dot, underscore, or dash.',
  'cli.runtime.provider.doctor.duplicateOAuthLabel':
    'OAuth account ref #{index} label duplicates an earlier OAuth label.',
  'cli.runtime.provider.doctor.missingModelProvider':
    'Model does not define a provider and no default provider is configured.',
  'cli.runtime.provider.doctor.missingModelProviderName':
    'Model points at missing provider "{providerName}".',
  'cli.runtime.provider.doctor.selfFallback': 'Model lists itself as a fallback.',
  'cli.runtime.provider.doctor.missingFallbackModel':
    'Fallback model "{fallback}" is not configured.',
  'cli.runtime.provider.doctor.unusedRouteWeight':
    'Route weight for "{weightAlias}" is ignored because it is not the model or a fallback.',
  'cli.runtime.provider.doctor.invalidPreferredCredential':
    'Preferred credential "{credential}" is not one of the expanded route candidates.',
  'cli.runtime.provider.doctor.scopeProvider': ' provider={providerId}',
  'cli.runtime.provider.doctor.scopeModel': ' model={modelAlias}',
  'cli.runtime.provider.doctor.scopeEnv': ' env={envVar}',

  // catalog
  'cli.runtime.provider.catalogProviderNotFound':
    'Provider "{providerId}" not found in catalog at {url}.',
  'cli.runtime.provider.catalogNoModels':
    'Provider "{providerId}" lists no usable models in this catalog.',
  'cli.runtime.provider.catalogProviderHeader': '{name} ({providerId})',
  'cli.runtime.provider.catalogModelLine': '  {id}  ctx={ctx}{capLabel}',
  'cli.runtime.provider.catalogNoMatch': 'No providers in catalog match "{filter}".',
  'cli.runtime.provider.catalogEmpty': 'Catalog is empty.',
  'cli.runtime.provider.catalogListLine':
    '{id}  wire={wire}  models={modelCount}  {name}',
  'cli.runtime.provider.catalogMissingApiKey':
    'Missing API key. Pass --api-key <key>, --api-key-env <name>, or set KIMI_REGISTRY_API_KEY.',
  'cli.runtime.provider.catalogUnsupportedWire':
    'Provider "{providerId}" has an unsupported wire type in the catalog.',
  'cli.runtime.provider.catalogModelNotInProvider':
    'Model "{model}" is not in provider "{providerId}". Run "liora provider catalog list {providerId}" to see available ids.',
  'cli.runtime.provider.catalogImported':
    'Imported {displayName} ({providerId}) with {modelCount} {modelUnit} from {url}.',
  'cli.runtime.provider.catalogDefaultModelSet': 'Default model set to {providerId}/{model}.',
  'cli.runtime.provider.fetchCatalogFailed': 'Failed to fetch catalog from {url}{suffix}: {error}',

  // parse / validation
  'cli.runtime.provider.passApiKeyOrEnv': 'Pass either --api-key or --api-key-env, not both.',
  'cli.runtime.provider.passRawOrEnvKeys':
    'Pass either raw API key options (--api-key/--api-keys) or environment reference options (--api-key-env/--api-key-envs), not both.',
  'cli.runtime.provider.passLabelOrLabels': 'Pass either --label or --labels, not both.',
  'cli.runtime.provider.labelOnlyForSingleKey':
    '--label can only be used when adding one API key. Use --labels for bulk adds.',
  'cli.runtime.provider.labelsCountMismatch':
    'The number of --labels entries must match the number of added API keys.',
  'cli.runtime.provider.duplicateCredentialLabel': 'Duplicate credential label "{label}".',
  'cli.runtime.provider.invalidCredentialLabel':
    'Invalid credential label "{label}". Use only letters, numbers, dot, underscore, or dash.',
  'cli.runtime.provider.invalidEnvVarName': 'Invalid environment variable name "{name}".',
  'cli.runtime.provider.apiKeyIndexPositive': 'API key index must be a positive integer.',
  'cli.runtime.provider.oauthIndexPositive': 'OAuth account ref index must be a positive integer.',
  'cli.runtime.provider.oauthStorageInvalid': 'OAuth storage must be "file" or "keyring".',
  'cli.runtime.provider.routingStrategyInvalid':
    'Routing strategy must be "auto", "fallback", "fill_first", "round_robin", "weighted_round_robin", "least_used", "lowest_latency", "rate_limit_aware", or "random".',
  'cli.runtime.provider.cooldownNonNegative':
    'Cooldown must be a non-negative integer number of milliseconds.',
  'cli.runtime.provider.sessionAffinityOnOff': 'Session affinity must be "on" or "off".',
  'cli.runtime.provider.weightsFormat': 'Weights must use comma-separated alias=weight entries.',
  'cli.runtime.provider.routeWeightsPositive': 'Route weights must be positive integers.',
  'cli.runtime.provider.routeWeightNotInRoute':
    'Route weight "{alias}" is not the model alias or one of its fallback models.',
  'cli.runtime.provider.preferredCredentialInvalid':
    'Preferred credential "{credential}" is not one of the route candidates. Run `liora provider route preview` to inspect credential labels.',
  'cli.runtime.provider.positiveIntRequired': '{label} must be a positive integer.',
  'cli.runtime.provider.providerTypeInvalid':
    'Provider type must be one of: anthropic, openai, kimi, google-genai, openai_responses, vertexai.',

  // pluralization units (English)
  'cli.runtime.provider.unit.provider': 'provider',
  'cli.runtime.provider.unit.providers': 'providers',
  'cli.runtime.provider.unit.model': 'model',
  'cli.runtime.provider.unit.models': 'models',
  'cli.runtime.provider.unit.apiKey': 'key',
  'cli.runtime.provider.unit.apiKeys': 'keys',
  'cli.runtime.provider.unit.oauthRef': 'ref',
  'cli.runtime.provider.unit.oauthRefs': 'refs',
  'cli.runtime.provider.unit.alias': 'alias',
  'cli.runtime.provider.unit.aliases': 'aliases',
  'cli.runtime.provider.unit.error': 'error',
  'cli.runtime.provider.unit.errors': 'errors',
  'cli.runtime.provider.unit.warning': 'warning',
  'cli.runtime.provider.unit.warnings': 'warnings',
  'cli.runtime.provider.unit.apiKeyWord': 'key',
  'cli.runtime.provider.unit.apiKeysWord': 'keys',
};

export const STRINGS_RUNTIME_PROVIDER_KO: Readonly<Record<string, string>> = {
  'cli.runtime.provider.missingRegistryApiKey':
    'API 키가 없습니다. --api-key <key>를 전달하거나 KIMI_REGISTRY_API_KEY를 설정하세요.',
  'cli.runtime.provider.registryUrlRequired': '레지스트리 URL이 필요합니다.',
  'cli.runtime.provider.fetchRegistryFailed': '레지스트리를 가져오지 못했습니다{suffix}: {error}',
  'cli.runtime.provider.registryEmpty': '{url} 레지스트리에 사용 가능한 프로바이더가 없습니다.',
  'cli.runtime.provider.importedHeader':
    '{url}에서 {count}개 {providerUnit}({modelCount}개 {modelUnit})을 가져왔습니다:',
  'cli.runtime.provider.importedItem': '  - {id}',

  'cli.runtime.provider.notFound': '프로바이더 "{providerId}"을(를) 찾을 수 없습니다.',
  'cli.runtime.provider.removed': '프로바이더 "{providerId}"을(를) 제거했습니다.',
  'cli.runtime.provider.noProvidersConfigured': '구성된 프로바이더가 없습니다.',
  'cli.runtime.provider.listLine':
    '{id}  type={type}  models={modelCount}  keys={keyCount}  source={source}',
  'cli.runtime.provider.listAliases': '  aliases: {aliases}',
  'cli.runtime.provider.listDefaultModel': '\n기본 모델: {label}',

  'cli.runtime.provider.modelAliasRequired': '모델 별칭이 필요합니다.',
  'cli.runtime.provider.modelNotFoundListHint':
    '모델 "{alias}"을(를) 찾을 수 없습니다. `liora provider list --json`으로 구성된 모델 별칭을 확인하세요.',
  'cli.runtime.provider.modelMissingProvider':
    '모델 "{alias}"이(가) 누락된 프로바이더 "{provider}"를 가리킵니다. `liora provider`로 구성된 프로바이더를 확인하세요.',
  'cli.runtime.provider.defaultModelSet': '기본 모델을 {label}(으)로 설정했습니다.',

  'cli.runtime.provider.missingBaseUrl': 'base URL이 없습니다. --base-url <url>을 전달하세요.',
  'cli.runtime.provider.missingModelId': '모델 ID가 없습니다. --model <modelId>를 전달하세요.',
  'cli.runtime.provider.missingCustomApiKey':
    'API 키가 없습니다. --api-key <key>, --api-key-env <name>을 전달하거나 KIMI_PROVIDER_API_KEY를 설정하거나, 로컬 엔드포인트에는 --keyless를 사용하세요.',
  'cli.runtime.provider.oauthChooseDifferentId':
    '프로바이더 "{providerId}"는 OAuth를 사용합니다. 다른 프로바이더 ID를 선택하세요.',
  'cli.runtime.provider.customEndpointAdded':
    '커스텀 엔드포인트 프로바이더 "{providerId}"와 모델 "{modelAlias}"을(를) 추가했습니다.',
  'cli.runtime.provider.defaultModelSetAlias': '기본 모델을 {alias}(으)로 설정했습니다.',

  'cli.runtime.provider.missingKeyAddApiKey':
    'API 키가 없습니다. --api-key <key>, --api-keys <keys>, --api-key-env <name>, --api-key-envs <names>를 전달하거나 KIMI_PROVIDER_API_KEY를 설정하세요.',
  'cli.runtime.provider.oauthApiKeyMixed':
    '프로바이더 "{providerId}"는 OAuth를 사용합니다. API 키를 함께 사용할 수 없습니다.',
  'cli.runtime.provider.apiKeyAlreadyConfigured':
    '프로바이더 "{providerId}"에 API {keyWord}이(가) 이미 구성되어 있습니다.',
  'cli.runtime.provider.apiKeyAdded': '프로바이더 "{providerId}"에 API 키를 추가했습니다.',
  'cli.runtime.provider.apiKeysAdded': '프로바이더 "{providerId}"에 API 키 {count}개를 추가했습니다.',
  'cli.runtime.provider.noApiKeys': '프로바이더 "{providerId}"에 구성된 API 키가 없습니다.',
  'cli.runtime.provider.apiKeysHeader':
    '프로바이더 "{providerId}"에 구성된 API {keyWord} {count}개:',
  'cli.runtime.provider.apiKeyListLine':
    '  #{index}  {role}{labelText}{rpmText}{tpmText}{baseUrlText}',
  'cli.runtime.provider.oauthApiKeyCannotRemove':
    '프로바이더 "{providerId}"는 OAuth를 사용합니다. API 키를 제거할 수 없습니다.',
  'cli.runtime.provider.apiKeyNotFound':
    '프로바이더 "{providerId}"에 API 키 #{index}이(가) 없습니다. `liora provider key list {providerId}`를 실행하세요.',
  'cli.runtime.provider.apiKeyRemoved': '프로바이더 "{providerId}"에서 API 키 #{index}을(를) 제거했습니다.',
  'cli.runtime.provider.oauthApiKeyCannotPromote':
    '프로바이더 "{providerId}"는 OAuth를 사용합니다. API 키를 승격할 수 없습니다.',
  'cli.runtime.provider.apiKeyAlreadyPrimary':
    '프로바이더 "{providerId}"의 API 키 #1이 이미 primary입니다.',
  'cli.runtime.provider.apiKeyPromoted':
    '프로바이더 "{providerId}"의 API 키 #{index}을(를) primary로 승격했습니다.',
  'cli.runtime.provider.oauthApiKeyCannotLabel':
    '프로바이더 "{providerId}"는 OAuth를 사용합니다. API 키에 레이블을 지정할 수 없습니다.',
  'cli.runtime.provider.credentialLabelDuplicate':
    '자격 증명 레이블 "{label}"은(는) 다른 API 키에서 이미 사용 중입니다.',
  'cli.runtime.provider.apiKeyLabeled':
    '프로바이더 "{providerId}"의 API 키 #{index}에 "{label}" 레이블을 지정했습니다.',
  'cli.runtime.provider.oauthApiKeyCannotUnlabel':
    '프로바이더 "{providerId}"는 OAuth를 사용합니다. API 키 레이블을 제거할 수 없습니다.',
  'cli.runtime.provider.apiKeyNoLabel':
    '프로바이더 "{providerId}"의 API 키 #{index}에 레이블이 없습니다.',
  'cli.runtime.provider.apiKeyLabelRemoved':
    '프로바이더 "{providerId}"의 API 키 #{index}에서 레이블을 제거했습니다.',
  'cli.runtime.provider.keyLimitNothingToUpdate':
    '업데이트할 항목이 없습니다. --rpm, --tpm 또는 --clear를 전달하세요.',
  'cli.runtime.provider.keyLimitClearOrValues':
    '--clear 또는 제한 값 중 하나만 전달하세요. 둘 다 사용할 수 없습니다.',
  'cli.runtime.provider.oauthApiKeyLimitsCannotChange':
    '프로바이더 "{providerId}"는 OAuth를 사용합니다. API 키 제한을 변경할 수 없습니다.',
  'cli.runtime.provider.keyLimitsCleared':
    '프로바이더 "{providerId}"의 API 키 #{index} 로컬 제한을 해제했습니다.',
  'cli.runtime.provider.keyLimitsUpdated':
    '프로바이더 "{providerId}"의 API 키 #{index} 로컬 제한을 업데이트했습니다.',
  'cli.runtime.provider.allApiKeysRemoved':
    '프로바이더 "{providerId}"의 모든 API 키를 제거했습니다.',

  'cli.runtime.provider.missingOAuthStorageKey': 'OAuth 저장소 키가 없습니다. --key <key>를 전달하세요.',
  'cli.runtime.provider.oauthApiKeyMixedInto':
    '프로바이더 "{providerId}"는 API 키를 사용합니다. OAuth 계정을 함께 사용할 수 없습니다.',
  'cli.runtime.provider.oauthRefAlreadyConfigured':
    '프로바이더 "{providerId}"에 OAuth 계정 ref가 이미 구성되어 있습니다.',
  'cli.runtime.provider.oauthRefAdded': '프로바이더 "{providerId}"에 OAuth 계정 ref를 추가했습니다.',
  'cli.runtime.provider.noOAuthRefs':
    '프로바이더 "{providerId}"에 구성된 OAuth 계정 ref가 없습니다.',
  'cli.runtime.provider.oauthRefsHeader':
    '프로바이더 "{providerId}"에 구성된 OAuth 계정 {refWord} {count}개:',
  'cli.runtime.provider.oauthListLine':
    '  #{index}  {role}{labelText}  storage={storage}  host={host}  fingerprint={fingerprint}',
  'cli.runtime.provider.oauthRefNotFound':
    '프로바이더 "{providerId}"에 OAuth 계정 ref #{index}이(가) 없습니다. `liora provider oauth list {providerId}`를 실행하세요.',
  'cli.runtime.provider.oauthRefRemoved':
    '프로바이더 "{providerId}"에서 OAuth 계정 ref #{index}을(를) 제거했습니다.',
  'cli.runtime.provider.oauthApiKeyCannotPromoteOAuth':
    '프로바이더 "{providerId}"는 API 키를 사용합니다. OAuth 계정을 승격할 수 없습니다.',
  'cli.runtime.provider.oauthRefAlreadyPrimary':
    '프로바이더 "{providerId}"의 OAuth 계정 ref #1이 이미 primary입니다.',
  'cli.runtime.provider.oauthRefPromoted':
    '프로바이더 "{providerId}"의 OAuth 계정 ref #{index}을(를) primary로 승격했습니다.',
  'cli.runtime.provider.oauthApiKeyCannotLabelOAuth':
    '프로바이더 "{providerId}"는 API 키를 사용합니다. OAuth 계정 ref에 레이블을 지정할 수 없습니다.',
  'cli.runtime.provider.oauthLabelDuplicate':
    'OAuth 레이블 "{label}"은(는) 다른 계정 ref에서 이미 사용 중입니다.',
  'cli.runtime.provider.oauthRefLabeled':
    '프로바이더 "{providerId}"의 OAuth 계정 ref #{index}에 "{label}" 레이블을 지정했습니다.',
  'cli.runtime.provider.oauthApiKeyCannotUnlabelOAuth':
    '프로바이더 "{providerId}"는 API 키를 사용합니다. OAuth 계정 ref 레이블을 제거할 수 없습니다.',
  'cli.runtime.provider.oauthRefNoLabel':
    '프로바이더 "{providerId}"의 OAuth 계정 ref #{index}에 레이블이 없습니다.',
  'cli.runtime.provider.oauthRefLabelRemoved':
    '프로바이더 "{providerId}"의 OAuth 계정 ref #{index}에서 레이블을 제거했습니다.',
  'cli.runtime.provider.allOAuthRefsRemoved':
    '프로바이더 "{providerId}"의 모든 OAuth 계정 ref를 제거했습니다.',

  'cli.runtime.provider.modelNotFound': '모델 "{modelAlias}"을(를) 찾을 수 없습니다.',
  'cli.runtime.provider.routeShowHeader': '{modelAlias} 라우트:',
  'cli.runtime.provider.routeShowProvider': '  provider: {provider}',
  'cli.runtime.provider.routeShowModel': '  model: {model}',
  'cli.runtime.provider.routeShowFallbackModels': '  fallback_models: {fallbacks}',
  'cli.runtime.provider.routeShowStrategy': '  strategy: {strategy}',
  'cli.runtime.provider.routeShowWeights': '  weights: {weights}',
  'cli.runtime.provider.routeShowSessionAffinity': '  session_affinity: {value}',
  'cli.runtime.provider.routeShowPreferredCredential': '  preferred_credential: {value}',
  'cli.runtime.provider.routeShowCooldownMs': '  cooldown_ms: {value}',
  'cli.runtime.provider.routeSetNothingToUpdate':
    '업데이트할 항목이 없습니다. --fallback, --strategy, --cooldown-ms, --weights, --session-affinity 또는 --prefer-credential을 전달하세요.',
  'cli.runtime.provider.fallbackModelNotConfigured':
    '폴백 모델 "{fallback}"이(가) 구성되어 있지 않습니다.',
  'cli.runtime.provider.selfFallback': '모델은 자기 자신을 폴백으로 지정할 수 없습니다.',
  'cli.runtime.provider.routeUpdated': '모델 "{modelAlias}" 라우트를 업데이트했습니다.',
  'cli.runtime.provider.autoRouteNeedsCandidates':
    '모델 "{modelAlias}" 자동 라우트에는 최소 두 개의 후보가 필요합니다. API 키/OAuth 계정을 추가하거나 --fallback <alias>를 전달하세요.',
  'cli.runtime.provider.autoRouteEnabled':
    '모델 "{modelAlias}"에 {count}개 후보로 자동 라우트를 활성화했습니다.',
  'cli.runtime.provider.routeResetNone':
    '세션 "{sessionId}"에 재설정할 프로바이더 라우트 상태가 없습니다.',
  'cli.runtime.provider.routeResetDone':
    '세션 "{sessionId}"의 "{modelAlias}" 프로바이더 라우트 상태를 재설정했습니다({count}개 후보).',
  'cli.runtime.provider.routeStatusNone':
    '세션 "{sessionId}"에 프로바이더 라우트 상태가 없습니다.',

  'cli.runtime.provider.valueNone': '(없음)',
  'cli.runtime.provider.valueAuto': '(자동)',
  'cli.runtime.provider.valueDefault': '(기본값)',
  'cli.runtime.provider.valueOn': 'on',
  'cli.runtime.provider.valueOff': 'off',
  'cli.runtime.provider.valueYes': 'yes',
  'cli.runtime.provider.valueNo': 'no',
  'cli.runtime.provider.rolePrimary': 'primary',
  'cli.runtime.provider.roleFallback': 'fallback',
  'cli.runtime.provider.routePreviewHeader': '{modelAlias} 라우트 미리보기:',
  'cli.runtime.provider.routePreviewActive': '  active: {value}',
  'cli.runtime.provider.routePreviewStrategy': '  strategy: {strategy}',
  'cli.runtime.provider.routePreviewFallbackModels': '  fallback_models: {fallbacks}',
  'cli.runtime.provider.routePreviewSessionAffinity': '  session_affinity: {value}',
  'cli.runtime.provider.routePreviewPreferredCredential': '  preferred_credential: {value}',
  'cli.runtime.provider.routePreviewCandidatesLabel': '  candidates:',
  'cli.runtime.provider.routeHealthHeader':
    '{modelAlias} 라우트 상태 (strategy={strategy}{affinityText}{preferredText}):',
  'cli.runtime.provider.routeHealthAffinityOn': ', affinity=on',
  'cli.runtime.provider.routeHealthPreferred': ', preferred={credential}',
  'cli.runtime.provider.routeHealthCooling': 'cooling {duration}',
  'cli.runtime.provider.routeHealthReady': 'ready',

  'cli.runtime.provider.autoRouteNoCandidates':
    '프로바이더 "{providerId}"의 모델 별칭 중 자동 라우트에 충분한 후보가 있는 것이 없습니다.',
  'cli.runtime.provider.autoRouteEnabledSummary':
    '{count}개 모델 {aliasWord}에 자동 라우트를 활성화했습니다: {aliases}.',

  'cli.runtime.provider.modelNotFoundThrow': '모델 "{modelAlias}"을(를) 찾을 수 없습니다.',
  'cli.runtime.provider.fallbackModelNotConfiguredThrow':
    '폴백 모델 "{modelAlias}"이(가) 구성되어 있지 않습니다.',
  'cli.runtime.provider.modelMustDefineProvider': '모델 "{modelAlias}"에 프로바이더를 정의해야 합니다.',
  'cli.runtime.provider.providerNotConfiguredForModel':
    '모델 "{modelAlias}"의 프로바이더 "{providerName}"이(가) 구성되어 있지 않습니다.',

  'cli.runtime.provider.doctor.ok':
    '프로바이더 doctor: 정상 (providers={providerCount}, models={modelCount}, routes={routeCount}, candidates={candidateCount})',
  'cli.runtime.provider.doctor.summary':
    '프로바이더 doctor: {errorCount}개 {errorWord}, {warningCount}개 {warningWord}',
  'cli.runtime.provider.doctor.issueLine': '  [{level}] {code}{scope}: {message}',
  'cli.runtime.provider.doctor.noProviders': '구성된 프로바이더가 없습니다.',
  'cli.runtime.provider.doctor.noModels': '구성된 모델 별칭이 없습니다.',
  'cli.runtime.provider.doctor.missingDefaultModel':
    '기본 모델 "{alias}"이(가) 구성되어 있지 않습니다.',
  'cli.runtime.provider.doctor.missingAuth':
    '프로바이더에 API 키, OAuth 계정, keyless 표시 또는 지원되는 서비스 계정 소스가 없습니다.',
  'cli.runtime.provider.doctor.mixedAuth':
    '프로바이더에 API 키 소스와 OAuth ref가 모두 있습니다. API 키 소스가 우선합니다.',
  'cli.runtime.provider.doctor.missingEnv':
    '환경 변수 "{envVar}"이(가) {source}에서 참조되지만 설정되어 있지 않습니다.',
  'cli.runtime.provider.doctor.emptyCredentialApiKey': '{source}에 빈 api_key가 있습니다.',
  'cli.runtime.provider.doctor.invalidCredentialLabel':
    '{source} 레이블은 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.',
  'cli.runtime.provider.doctor.invalidCredentialBaseUrl':
    '{source} base_url은 http:// 또는 https://로 시작해야 합니다.',
  'cli.runtime.provider.doctor.duplicateCredential':
    '{source}이(가) 이전 API 키/base_url 슬롯과 중복되어 무시됩니다.',
  'cli.runtime.provider.doctor.duplicateCredentialLabel':
    'credentials[{index}] 레이블이 이전 자격 증명 레이블과 중복됩니다.',
  'cli.runtime.provider.doctor.invalidOAuthLabel':
    'OAuth 계정 ref #{index} 레이블은 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.',
  'cli.runtime.provider.doctor.duplicateOAuthLabel':
    'OAuth 계정 ref #{index} 레이블이 이전 OAuth 레이블과 중복됩니다.',
  'cli.runtime.provider.doctor.missingModelProvider':
    '모델에 프로바이더가 없고 기본 프로바이더도 구성되어 있지 않습니다.',
  'cli.runtime.provider.doctor.missingModelProviderName':
    '모델이 누락된 프로바이더 "{providerName}"을(를) 가리킵니다.',
  'cli.runtime.provider.doctor.selfFallback': '모델이 자기 자신을 폴백으로 지정했습니다.',
  'cli.runtime.provider.doctor.missingFallbackModel':
    '폴백 모델 "{fallback}"이(가) 구성되어 있지 않습니다.',
  'cli.runtime.provider.doctor.unusedRouteWeight':
    '"{weightAlias}" 라우트 가중치는 모델 또는 폴백이 아니므로 무시됩니다.',
  'cli.runtime.provider.doctor.invalidPreferredCredential':
    '선호 자격 증명 "{credential}"이(가) 확장된 라우트 후보 중 하나가 아닙니다.',
  'cli.runtime.provider.doctor.scopeProvider': ' provider={providerId}',
  'cli.runtime.provider.doctor.scopeModel': ' model={modelAlias}',
  'cli.runtime.provider.doctor.scopeEnv': ' env={envVar}',

  'cli.runtime.provider.catalogProviderNotFound':
    '카탈로그 {url}에서 프로바이더 "{providerId}"을(를) 찾을 수 없습니다.',
  'cli.runtime.provider.catalogNoModels':
    '프로바이더 "{providerId}"에 이 카탈로그에서 사용 가능한 모델이 없습니다.',
  'cli.runtime.provider.catalogProviderHeader': '{name} ({providerId})',
  'cli.runtime.provider.catalogModelLine': '  {id}  ctx={ctx}{capLabel}',
  'cli.runtime.provider.catalogNoMatch': '카탈로그에 "{filter}"와(과) 일치하는 프로바이더가 없습니다.',
  'cli.runtime.provider.catalogEmpty': '카탈로그가 비어 있습니다.',
  'cli.runtime.provider.catalogListLine':
    '{id}  wire={wire}  models={modelCount}  {name}',
  'cli.runtime.provider.catalogMissingApiKey':
    'API 키가 없습니다. --api-key <key>, --api-key-env <name>을 전달하거나 KIMI_REGISTRY_API_KEY를 설정하세요.',
  'cli.runtime.provider.catalogUnsupportedWire':
    '프로바이더 "{providerId}"의 카탈로그 wire 타입이 지원되지 않습니다.',
  'cli.runtime.provider.catalogModelNotInProvider':
    '모델 "{model}"이(가) 프로바이더 "{providerId}"에 없습니다. "liora provider catalog list {providerId}"로 사용 가능한 ID를 확인하세요.',
  'cli.runtime.provider.catalogImported':
    '{url}에서 {displayName} ({providerId})과(와) {modelCount}개 {modelUnit}을(를) 가져왔습니다.',
  'cli.runtime.provider.catalogDefaultModelSet': '기본 모델을 {providerId}/{model}(으)로 설정했습니다.',
  'cli.runtime.provider.fetchCatalogFailed':
    '{url}에서 카탈로그를 가져오지 못했습니다{suffix}: {error}',

  'cli.runtime.provider.passApiKeyOrEnv':
    '--api-key 또는 --api-key-env 중 하나만 전달하세요. 둘 다 사용할 수 없습니다.',
  'cli.runtime.provider.passRawOrEnvKeys':
    '원시 API 키 옵션(--api-key/--api-keys) 또는 환경 변수 참조 옵션(--api-key-env/--api-key-envs) 중 하나만 전달하세요.',
  'cli.runtime.provider.passLabelOrLabels':
    '--label 또는 --labels 중 하나만 전달하세요.',
  'cli.runtime.provider.labelOnlyForSingleKey':
    '--label은 API 키 하나를 추가할 때만 사용할 수 있습니다. 여러 개 추가 시 --labels를 사용하세요.',
  'cli.runtime.provider.labelsCountMismatch':
    '--labels 항목 수는 추가하는 API 키 수와 일치해야 합니다.',
  'cli.runtime.provider.duplicateCredentialLabel':
    '자격 증명 레이블 "{label}"이(가) 중복됩니다.',
  'cli.runtime.provider.invalidCredentialLabel':
    '자격 증명 레이블 "{label}"이(가) 유효하지 않습니다. 영문, 숫자, 점, 밑줄, 하이픈만 사용하세요.',
  'cli.runtime.provider.invalidEnvVarName':
    '환경 변수 이름 "{name}"이(가) 유효하지 않습니다.',
  'cli.runtime.provider.apiKeyIndexPositive': 'API 키 인덱스는 양의 정수여야 합니다.',
  'cli.runtime.provider.oauthIndexPositive': 'OAuth 계정 ref 인덱스는 양의 정수여야 합니다.',
  'cli.runtime.provider.oauthStorageInvalid': 'OAuth storage는 "file" 또는 "keyring"이어야 합니다.',
  'cli.runtime.provider.routingStrategyInvalid':
    '라우팅 전략은 "auto", "fallback", "fill_first", "round_robin", "weighted_round_robin", "least_used", "lowest_latency", "rate_limit_aware", "random" 중 하나여야 합니다.',
  'cli.runtime.provider.cooldownNonNegative':
    'Cooldown은 0 이상의 정수 밀리초여야 합니다.',
  'cli.runtime.provider.sessionAffinityOnOff': 'Session affinity는 "on" 또는 "off"여야 합니다.',
  'cli.runtime.provider.weightsFormat':
    '가중치는 쉼표로 구분된 alias=weight 형식이어야 합니다.',
  'cli.runtime.provider.routeWeightsPositive': '라우트 가중치는 양의 정수여야 합니다.',
  'cli.runtime.provider.routeWeightNotInRoute':
    '라우트 가중치 "{alias}"는 모델 별칭 또는 폴백 모델 중 하나가 아닙니다.',
  'cli.runtime.provider.preferredCredentialInvalid':
    '선호 자격 증명 "{credential}"이(가) 라우트 후보 중 하나가 아닙니다. `liora provider route preview`로 자격 증명 레이블을 확인하세요.',
  'cli.runtime.provider.positiveIntRequired': '{label}은(는) 양의 정수여야 합니다.',
  'cli.runtime.provider.providerTypeInvalid':
    '프로바이더 타입은 anthropic, openai, kimi, google-genai, openai_responses, vertexai 중 하나여야 합니다.',

  'cli.runtime.provider.unit.provider': '프로바이더',
  'cli.runtime.provider.unit.providers': '프로바이더',
  'cli.runtime.provider.unit.model': '모델',
  'cli.runtime.provider.unit.models': '모델',
  'cli.runtime.provider.unit.apiKey': '키',
  'cli.runtime.provider.unit.apiKeys': '키',
  'cli.runtime.provider.unit.oauthRef': 'ref',
  'cli.runtime.provider.unit.oauthRefs': 'ref',
  'cli.runtime.provider.unit.alias': '별칭',
  'cli.runtime.provider.unit.aliases': '별칭',
  'cli.runtime.provider.unit.error': '오류',
  'cli.runtime.provider.unit.errors': '오류',
  'cli.runtime.provider.unit.warning': '경고',
  'cli.runtime.provider.unit.warnings': '경고',
  'cli.runtime.provider.unit.apiKeyWord': '키',
  'cli.runtime.provider.unit.apiKeysWord': '키',
};
