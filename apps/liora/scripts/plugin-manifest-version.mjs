import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Read a local plugin directory's declared version from its Claude Code
// manifest (`.claude-plugin/plugin.json`). Returns undefined when no
// manifest is present or the manifest has no version.
export async function readPluginManifestVersion(pluginDir) {
  const raw = await readFileOrUndefined(resolve(pluginDir, '.claude-plugin/plugin.json'));
  if (raw === undefined) return undefined;
  return versionFromManifest(raw);
}

async function readFileOrUndefined(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

function versionFromManifest(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.version === 'string') {
      const trimmed = parsed.version.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
