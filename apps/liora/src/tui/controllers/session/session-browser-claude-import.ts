import { buildClaudeImportPlan, formatClaudeImportSummary, resolveClaudeImportRoots, type ClaudeImportScanEntry } from '../../utils/claude-import';
import type { SessionBrowserHost } from './session-browser';

export async function runClaudeImportInventoryForHost(host: SessionBrowserHost): Promise<void> {
    const workDir = host.state.appState.workDir;
    const roots = resolveClaudeImportRoots(workDir);
    const entries: ClaudeImportScanEntry[] = [];

    const nodeFs = await import('node:fs');
    const nodePath = await import('node:path');
    const readdirSync = nodeFs.readdirSync.bind(nodeFs);
    const statSync = nodeFs.statSync.bind(nodeFs);
    const join = nodePath.join.bind(nodePath);
    const relative = nodePath.relative.bind(nodePath);

    const walk = (
      rootPath: string,
      rootKind: 'project' | 'global',
      maxDepth: number,
      depth = 0,
    ): void => {
      if (depth > maxDepth) return;
      let dirents: import('node:fs').Dirent[];
      try {
        dirents = readdirSync(rootPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (dirent.name === '.' || dirent.name === '..') continue;
        if (
          /^\.env/i.test(dirent.name) ||
          /\.(pem|key|p12|pfx)$/i.test(dirent.name)
        ) {
          continue;
        }
        const absolutePath = join(rootPath, dirent.name);
        let isDir = dirent.isDirectory();
        if (!isDir && !dirent.isFile()) {
          try {
            isDir = statSync(absolutePath).isDirectory();
          } catch {
            continue;
          }
        }
        if (isDir) {
          walk(absolutePath, rootKind, maxDepth, depth + 1);
          continue;
        }
        entries.push({
          absolutePath,
          relativePath: relative(rootPath, absolutePath),
          rootKind,
        });
      }
    };

    for (const root of roots) {
      walk(root.path, root.kind, 3);
    }

    const plan = buildClaudeImportPlan(workDir, entries);
    const summary = formatClaudeImportSummary(plan);
    for (const line of summary.split('\n')) {
      if (line.trim().length > 0) host.showStatus(line, 'textMuted');
    }
}
