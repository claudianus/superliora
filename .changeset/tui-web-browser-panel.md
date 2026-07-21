---
'@superliora/liora': minor
---

Add an in-app web browser panel with browser-use integration

- URL bar navigation, back/forward, reload, tab browsing (T/W/1-9), a JavaScript console (C), page zoom, and a form input mode (I) for text fields.
- Renders page screenshots through the Kitty graphics protocol with a text-snapshot fallback on non-Kitty terminals; uses the existing browser-use runtime (CloakBrowser/Camoufox/Lightpanda) for full JS/CSS execution.
- A state-keyed render cache skips re-rendering frames when panel state is unchanged.
