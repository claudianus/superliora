import { createHash } from 'node:crypto';

import type { OAuthRef, ProviderConfig } from '../../config';

import { nonEmptyString } from './provider-manager-config-values';

export function providerOAuthRef(
  provider: ProviderConfig,
  credentialLabel: string | undefined,
): OAuthRef | undefined {
  const oauthRefs = providerOAuthRefs(provider);
  if (credentialLabel === undefined) return oauthRefs[0];
  const index = oauthCredentialIndex(credentialLabel, oauthRefs);
  return index === undefined ? oauthRefs[0] : oauthRefs[index];
}

export function providerOAuthRefs(provider: ProviderConfig): OAuthRef[] {
  return uniqueOAuthRefs([
    ...(provider.oauth === undefined ? [] : [provider.oauth]),
    ...(provider.oauths ?? []),
  ]);
}

function uniqueOAuthRefs(values: readonly OAuthRef[]): OAuthRef[] {
  const seen = new Set<string>();
  const unique: OAuthRef[] = [];
  for (const value of values) {
    const key = JSON.stringify([value.storage, value.key, value.oauthHost ?? '']);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

export function oauthCredentialLabel(ref: OAuthRef, index: number): string {
  const label = nonEmptyString(ref.label);
  return label === undefined ? `oauth:${String(index + 1)}` : `oauth:${label}`;
}

function oauthCredentialIndex(
  credentialLabel: string,
  refs: readonly OAuthRef[],
): number | undefined {
  const labelMatch = refs.findIndex(
    (ref, index) => oauthCredentialLabel(ref, index) === credentialLabel,
  );
  if (labelMatch >= 0) return labelMatch;
  const match = /^oauth:(\d+)$/.exec(credentialLabel);
  if (match?.[1] === undefined) return undefined;
  const index = Number(match[1]);
  return Number.isInteger(index) && index > 0 ? index - 1 : undefined;
}

export function fingerprintOAuthRef(ref: OAuthRef): string {
  return createHash('sha256')
    .update(JSON.stringify([ref.storage, ref.key, ref.oauthHost ?? '']))
    .digest('hex')
    .slice(0, 12);
}
