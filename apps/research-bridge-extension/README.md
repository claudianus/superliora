# SuperLiora Research Bridge (Chrome MV3)

Minimal Chrome extension that exposes logged-in **history search** to SuperLiora Deep Research (Ch5) via native messaging + loopback HTTP.

## Architecture

```
SuperLiora agent  →  POST /search (loopback)  →  native host --serve
                                                      ↓ relay TCP
Chrome extension  ↔  native host stdio  ↔  chrome.history.search
```

When no extension relay is connected, `--serve` falls back to deterministic stub results.

## Load unpacked

1. Generate placeholder icons (once):

   ```bash
   pnpm -C apps/research-bridge-extension run icons
   ```

2. Open `chrome://extensions`, enable **Developer mode**, **Load unpacked**, select `apps/research-bridge-extension/`.

3. Copy the extension ID from the card (32-char hex).

## Install native messaging host

macOS:

```bash
pnpm -C apps/research-bridge-extension run install:native-host:macos -- --extension-id YOUR_EXTENSION_ID
```

Linux:

```bash
pnpm -C apps/research-bridge-extension run install:native-host:linux -- --extension-id YOUR_EXTENSION_ID
```

Or pass an explicit origin:

```bash
pnpm -C apps/research-bridge-extension run install:native-host -- \
  --allowed-origin chrome-extension://YOUR_EXTENSION_ID/
```

This writes `com.superliora.research_bridge.json` pointing at `packages/agent-core/scripts/research-bridge-native-host.mjs`.

## Run loopback bridge

```bash
node packages/agent-core/scripts/research-bridge-native-host.mjs --serve
```

Default URL: `http://127.0.0.1:32123/search` (override with `SUPERLIORA_CHROME_EXT_URL`). Relay port defaults to search port + 1 (`32124`).

Enable in SuperLiora:

```bash
export SUPERLIORA_CHROME_RESEARCH_BRIDGE=1
```

## Smoke

```bash
node packages/agent-core/scripts/research-bridge-native-host.mjs --smoke
node packages/agent-core/scripts/research-bridge-native-host.mjs --probe-loopback
```
