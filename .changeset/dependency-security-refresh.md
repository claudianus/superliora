---
"@superliora/liora": patch
---

Clear the open dependency advisories: transitive-patch overrides lift protobufjs, tar, ws, hono, fast-uri, adm-zip, brace-expansion, browserslist, ip-address, qs, @xmldom/xmldom, body-parser, @hono/node-server, @protobufjs/utf8 and esbuild in the shipped CLI graph; sharp moves to 0.35; the static site's vite/plugin pair moves to the patched vite 8 line so the vitest-resolved vite lands on a non-vulnerable version too (vitest itself stays pinned); and ssh2's unbuilt optional native `cpu-features` is excluded so CLI bundling stays intact. Audit reports zero advisories across production and dev.
