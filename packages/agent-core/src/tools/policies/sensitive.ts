/**
 * Sensitive-file detection.
 *
 * The pattern list is intentionally small to avoid false positives; files
 * matching any of these patterns are blocked from Read/Write/Edit so
 * credentials cannot be exfiltrated through a compromised prompt. Exemptions
 * like `.env.example` are explicitly allowed.
 *
 * Two layers apply:
 *   - basename / extension rules (private keys, `.env*`, `credentials`)
 *   - directory-scoped credential stores (`/.ssh/`, `/.gnupg/`, `/.kube/config`,
 *     `/.docker/config.json`, `/.aws/config`). These match the whole directory
 *     for `.ssh`/`.gnupg` (which hold assorted secrets — `config`, `known_hosts`,
 *     `authorized_keys`, keyrings) and exact files for the cloud CLIs.
 */

import { basename } from 'pathe';

const SENSITIVE_BASENAMES = new Set<string>([
  '.env',
  // dotenv-like secret dump often left in cwd (`.envrc` stays allowed — common
  // direnv config that is not always secrets; covered only when named secrets.env).
  'secrets.env',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'credentials',
  // Common credential dumps that are not covered by `.env*` / cloud suffixes.
  '.netrc',
  '_netrc',
  '.pgpass',
  'kubeconfig',
  'service-account.json',
  '.npmrc',
  '.pypirc',
  // Google ADC file name (often in cwd or ~/.config/gcloud/).
  'application_default_credentials.json',
  // Extra auth blobs frequently left in home/cwd.
  // Note: bare `credentials.json` stays allowed (common app config name);
  // cloud CLI paths under ~/.azure / ~/.pulumi / etc. use path suffixes.
  '.git-credentials',
  '.gitcookies',
  'token.json',
  'client_secret.json',
  'secrets.yaml',
  'secrets.yml',
  'secrets.toml',
  'secrets.json',
]);

// Path suffixes must be lowercase — matching uses comparable() paths.
const SENSITIVE_PATH_SUFFIXES = [
  ['.aws', 'credentials'],
  ['.aws', 'config'],
  ['.gcp', 'credentials'],
  ['.kube', 'config'],
  ['.docker', 'config.json'],
  ['.composer', 'auth.json'],
  ['.config', 'gh', 'hosts.yml'],
  ['.config', 'gcloud', 'application_default_credentials.json'],
  ['.config', 'gcloud', 'credentials.db'],
  ['.config', 'gh', 'hosts.yaml'],
  ['.azure', 'accesstokens.json'],
  ['.azure', 'msal_token_cache.json'],
  ['.pulumi', 'credentials.json'],
];

/**
 * Directory-scoped credential stores. The path is treated as sensitive if it
 * is inside one of these directories. `.ssh` and `.gnupg` hold assorted
 * secrets (keyrings, trusted-key lists, `config`, `known_hosts`,
 * `authorized_keys`), so the whole directory is protected rather than a few
 * well-known basenames.
 */
const SENSITIVE_DIRECTORY_PARTS = new Set<string>(['.ssh', '.gnupg']);

const ENV_PREFIX = '.env.';
const ENV_EXEMPTIONS = new Set<string>(['.env.example', '.env.sample', '.env.template']);

const SENSITIVE_BASENAME_PREFIXES = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'credentials'];
const PUBLIC_KEY_BASENAMES = new Set<string>(['id_rsa.pub', 'id_ed25519.pub', 'id_ecdsa.pub']);
export const SENSITIVE_DOT_VARIANT_SUFFIXES = [
  '.bak',
  '.backup',
  '.copy',
  '.disabled',
  '.key',
  '.old',
  '.orig',
  '.pem',
  '.save',
  '.tmp',
] as const;
const SENSITIVE_DOT_VARIANT_SUFFIX_SET = new Set<string>(SENSITIVE_DOT_VARIANT_SUFFIXES);

function comparable(path: string): string {
  return path.toLowerCase();
}

export function isSensitiveFile(path: string): boolean {
  const name = basename(path);
  const comparableName = comparable(name);
  const comparablePath = comparable(path);

  if (ENV_EXEMPTIONS.has(comparableName)) return false;
  if (PUBLIC_KEY_BASENAMES.has(comparableName)) return false;
  if (SENSITIVE_BASENAMES.has(comparableName)) return true;
  if (comparableName.startsWith(ENV_PREFIX)) return true;

  for (const prefix of SENSITIVE_BASENAME_PREFIXES) {
    if (comparableName === prefix) return true;
    // Catch rename-shielded variants without flagging unrelated filenames
    // like `id_rsafoo` or ordinary JSON files like `credentials.json`.
    if (comparableName.length > prefix.length && comparableName.startsWith(prefix)) {
      const suffix = comparableName.slice(prefix.length);
      const next = suffix[0];
      if (next === '-' || next === '_') return true;
      if (next === '.' && SENSITIVE_DOT_VARIANT_SUFFIX_SET.has(suffix)) return true;
    }
  }

  for (const suffixParts of SENSITIVE_PATH_SUFFIXES) {
    if (pathEndsWithSegments(comparablePath, suffixParts)) {
      return true;
    }
  }

  // Directory-scoped credential stores: protect everything under `/.ssh/` and
  // `/.gnupg/` (and a leading `~/.ssh` with no trailing slash). These hold
  // assorted secrets beyond the named keys already covered above.
  if (pathIncludesDirectoryPart(comparablePath, SENSITIVE_DIRECTORY_PARTS)) {
    return true;
  }

  return false;
}

/**
 * True when the path ends with the given segment sequence. Handles both
 * `/home/u/.aws/credentials` and the relative `.aws/credentials` without a
 * leading slash, while rejecting partial-segment matches.
 */
function pathEndsWithSegments(comparablePath: string, segments: readonly string[]): boolean {
  const pathSegments = comparablePath.split('/').filter((seg) => seg.length > 0);
  if (pathSegments.length < segments.length) return false;
  const tail = pathSegments.slice(pathSegments.length - segments.length);
  return tail.every((seg, i) => seg === segments[i]);
}

/**
 * True when any path segment matches a sensitive directory part. Handles
 * `/home/u/.ssh/config` (mid-path), `/home/u/.ssh` (trailing directory), and
 * `.ssh/config` (relative, no leading slash) without flagging unrelated files
 * like `myapp.ssh/config` (`.ssh` is not a whole segment there).
 */
function pathIncludesDirectoryPart(
  comparablePath: string,
  parts: Set<string>,
): boolean {
  const segments = comparablePath.split('/').filter((seg) => seg.length > 0);
  for (const segment of segments) {
    if (parts.has(segment)) return true;
  }
  return false;
}
