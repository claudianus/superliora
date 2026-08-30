---
"@superliora/liora": minor
"@superliora/kosong": patch
"@superliora/sdk": patch
---

Resolve catalog wires per model from metadata and split multi-protocol providers by wire. Add a package-to-wire registry so a gateway that serves several protocols from one API root selects the wire from the model's `provider.npm` instead of the model name, and group models by wire so each protocol gets its own provider entry with the correct API root.
