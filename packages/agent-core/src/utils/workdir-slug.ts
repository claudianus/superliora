const MAX_WORKDIR_SLUG_LENGTH = 40;

/**
 * Windows reserved device names. `CreateDirectoryW` rejects a path component
 * matching one of these (with or without an extension), so a directory named
 * `con` or `nul.txt` fails to be created with an opaque ENOENT/EPERM long
 * after the name looked valid.
 */
const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** Device stem of a path component: `NUL.txt` reserves `NUL`. */
export function windowsDeviceStem(name: string): string | undefined {
  const base = name.split('.')[0] ?? '';
  return base === '' ? undefined : base.toLowerCase();
}

/** True when `name` cannot be used as a directory component on Windows. */
export function isWindowsReservedDirName(name: string): boolean {
  const stem = windowsDeviceStem(name);
  return stem !== undefined && WINDOWS_RESERVED_NAMES.has(stem);
}

/**
 * Filesystem-safe directory component.
 *
 * Trailing dots and spaces are removed because Windows strips them silently:
 * keeping them made `my.project.` and `my.project` resolve to one directory
 * while the registry held two different entries pointing at it. A reserved
 * device name is suffixed rather than rejected, because callers include
 * internal slugs (repo directory names) that have no user-facing name to
 * validate — `normalizeWorktreeName` rejects those explicitly for user input.
 */
export function slugifyWorkDirName(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, MAX_WORKDIR_SLUG_LENGTH)
    .replaceAll(/^-+|-+$/g, '')
    .replaceAll(/[. ]+$/g, '');
  if (slug === '' || slug === '.' || slug === '..') return 'workspace';
  return isWindowsReservedDirName(slug) ? `${slug}-worktree` : slug;
}
