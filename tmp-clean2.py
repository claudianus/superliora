from pathlib import Path
import re

path = Path('apps/liora/src/tui/liora-tui.ts')
text = path.read_text()

# Delete renderBottomStatusBar including its doc comment
text2, n = re.subn(
    r'\n  /\*\*\n   \* Render the always-on Bloomberg-style status bar[\s\S]*?\n  private renderBottomStatusBar\([\s\S]*?\n  \}\n(?=\n  private startEventLoop)',
    '\n',
    text,
    count=1,
)
print('removed renderBottomStatusBar', n)
text = text2

# Delete orphaned workspace overlay comment before stopNativeRendererAdapters
text2, n = re.subn(
    r'\n  /\*\*\n   \* Workspace overlays \(stats/search/palette/preset/help/switcher\) and[\s\S]*?the editor\.\n   \*/\n  private stopNativeRendererAdapters',
    '\n  private stopNativeRendererAdapters',
    text,
    count=1,
)
print('removed orphan comment', n)
text = text2

# Remove dispose leftovers if any
for line in [
    '    // Persist workspace layout before shutdown\n',
    '    this.workspaceLayoutPersistence?.saveNow();\n',
    '    this.workspaceLayoutPersistence?.dispose();\n',
    '    this.kittyDndTrackingDispose?.();\n',
    '    this.kittyDndTrackingDispose = undefined;\n',
]:
    text = text.replace(line, '')

path.write_text(text)
print('renderStatusBar refs', text.count('renderStatusBar'))
print('workspaceController', text.count('workspaceController'))
