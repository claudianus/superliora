---
'@superliora/liora': patch
---

Make the serialized tool order deterministic. Tool names are now sorted byte-wise (locale-independent) instead of via the host-locale `localeCompare`, so the prompt-cache tools block stays identical across environments/ICU versions rather than varying with the host locale.
