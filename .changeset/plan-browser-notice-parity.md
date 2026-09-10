---
'@superliora/liora': patch
---

Keep the `/plan` mode announcement ("Plan mode: ON … Plan file: …") intact and open the Plan browser only from the mode-aware `P` shortcut. `P` on an empty idle prompt still starts Plan mode and surfaces the current plan once planning lands inline; the browser is no longer auto-mounted by `/plan`, so enabling planning always announces as documented.
