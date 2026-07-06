# SuperLiora Site — Visual & Motion Design Spec

> Deliverable for the `apps/site` remake (Vite 6 + Tailwind CSS 4). This spec is intended as a handoff for the integration owner; it does not include final copy — that comes from the Technical Writer lane.

---

## 0. As-built Implementation Notes

The site was implemented with Vite 6 but uses a custom **vanilla CSS architecture** instead of Tailwind CSS 4. The `@tailwindcss/vite` plugin remains in `vite.config.ts` for future compatibility, but the production styles live in `src/style.css` and are plain CSS with custom properties.

### Actual file structure

```
apps/site/
├── index.html                 # Korean landing page (lang="ko")
├── en/index.html              # English landing page (lang="en")
├── public/
│   └── assets/
│       └── hero-command-center.png   # Open Graph / docs-deploy asset
├── src/
│   ├── style.css              # Design tokens, layout, components, keyframes
│   └── main.js                # Theme, reveals, particles, glow, tilt, typing, copy, nav
├── package.json
├── vite.config.ts             # base: '/superliora/', multi-page input
└── .gitignore
```

### Deviations from the Tailwind-first plan

- **No Tailwind utility classes** in the shipped pages; CSS is component-based and custom-property driven.
- **Theme persistence** is enabled via `localStorage('superliora-theme')`; the original spec called for no persistence.
- **Hero visual** uses a code-drawn SVG harness diagram instead of a static hero image; the remaining section visuals (Ultra workflow, Memory & Wiki, Premium terminal) are inline SVGs. Only `hero-command-center.png` is kept in `public/assets/` for Open Graph and the docs-deploy workflow.
- **Additional sections** added beyond the original AC4 map: `Problem`, `Solution`, `Ultra workflow`, `Proof`, `Harness capabilities`, `Memory & Wiki`, `Premium operator surface`, `Capabilities`, `Visual debugging`, `Install`, and `CTA`.
- **Language switcher** uses simple anchor links (`/superliora/` and `/superliora/en/`).
- **Mouse glow** follows the cursor with a fixed-position element, not CSS variables on the root.
- **Particle network** uses a canvas with DPR scaling and pauses on `document.hidden`.
- **Scroll reveals** are driven by `IntersectionObserver` adding `.is-visible`.
- **3D tilt** is applied via `perspective(1000px) rotateX/Y` on hover, disabled on touch and reduced-motion devices.

### Verified build outputs

- `pnpm -C apps/site run build` produces `dist/` with `index.html`, `en/index.html`, and hashed CSS/JS assets.
- `dist/assets/` contains the four PNG assets copied from `public/assets/` (un-hashed public files).
- `base: '/superliora/'` means production URLs are `https://claudianus.github.io/superliora/` and `.../superliora/en/`.



## 1. Package & File Structure

New workspace package: `apps/site`

```
apps/site/
├── index.html                 # Korean landing page
├── en/index.html              # English landing page
├── public/                    # Static, un-hashed assets
│   ├── hero-command-center.png
│   ├── ultra-orchestration.png
│   ├── memory-wiki-themes.png
│   └── agent-cockpit.png
├── src/
│   ├── style.css              # Tailwind entry + @theme tokens + keyframes
│   ├── main.js                # Effects: particles, glow, tilt, reveals, typing, copy, theme
│   └── assets/                # Optional: SVG icons, fonts if self-hosted
├── package.json
├── vite.config.ts
└── .gitignore
```

**Monorepo notes:**
- `apps/site` is already covered by `pnpm-workspace.yaml` (`apps/*`), but **must be added manually to `flake.nix`** under both `workspacePaths` and `workspaceNames`.
- Vite `base` must be `'/superliora/'` because the GitHub Pages URL is `https://claudianus.github.io/superliora/`.

---

## 2. Tailwind v4 Setup (CSS-first)

No `tailwind.config.js`. Use the first-party Vite plugin:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/superliora/',
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        en: './en/index.html',
      },
    },
  },
});
```

```css
/* src/style.css */
@import "tailwindcss";
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+KR:wght@400;500;700;800&display=swap');

@theme {
  /* Surfaces */
  --color-bg: #06080d;
  --color-bg-2: #0a0e15;
  --color-bg-3: #0d1320;
  --color-surface: #0e1420;
  --color-text: #f5f8ff;
  --color-muted: #9aa9bd;
  --color-soft: #c9d4e4;

  /* Accents */
  --color-cyan: #48d8ff;
  --color-teal: #5efad5;
  --color-emerald: #66f2a2;
  --color-violet: #b48cff;
  --color-amber: #ffce6a;
  --color-rose: #ff77b7;

  /* Glass */
  --color-panel: rgba(14, 20, 31, 0.78);
  --color-panel-strong: rgba(19, 28, 42, 0.92);
  --color-line: rgba(185, 216, 255, 0.16);
  --color-line-strong: rgba(185, 216, 255, 0.28);
  --color-glow: rgba(72, 216, 255, 0.14);

  /* Typography */
  --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* Spacing / layout */
  --spacing-section: 6rem;
  --spacing-section-lg: 7.5rem;
  --max-content: 1180px;

  /* Custom keyframes (registered by @theme) */
  --animate-mesh: mesh 24s linear infinite;
  --animate-breathe: breathe 8s ease-in-out infinite;
  --animate-pulse-slow: pulse-slow 3s ease-in-out infinite;
}

/* Light theme overrides — toggled manually, no persistence */
[data-theme="light"] {
  --color-bg: #f5f7fa;
  --color-bg-2: #eef1f5;
  --color-bg-3: #e6ebf0;
  --color-surface: #ffffff;
  --color-text: #0d1117;
  --color-muted: #5b6b7b;
  --color-soft: #334155;
  --color-cyan: #0ea5e9;
  --color-teal: #10b981;
  --color-emerald: #059669;
  --color-violet: #8b5cf6;
  --color-amber: #d97706;
  --color-rose: #e11d48;
  --color-panel: rgba(255, 255, 255, 0.72);
  --color-panel-strong: rgba(255, 255, 255, 0.88);
  --color-line: rgba(15, 23, 42, 0.12);
  --color-line-strong: rgba(15, 23, 42, 0.2);
  --color-glow: rgba(14, 165, 233, 0.12);
}

html {
  color-scheme: dark;
  scroll-behavior: smooth;
}

[data-theme="light"] html {
  color-scheme: light;
}

body {
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
}

/* Base resets */
img {
  display: block;
  max-width: 100%;
}

a {
  color: inherit;
  text-decoration: none;
}

/* Keyframes */
@keyframes mesh {
  0% { transform: rotate(0deg) scale(1.2); }
  50% { transform: rotate(180deg) scale(1.35); }
  100% { transform: rotate(360deg) scale(1.2); }
}

@keyframes breathe {
  0%, 100% { opacity: 0.35; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(1.05); }
}

@keyframes pulse-slow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
```

---

## 3. Color Palette

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--color-bg` | `#06080d` | `#f5f7fa` | page background |
| `--color-bg-2` | `#0a0e15` | `#eef1f5` | card / section background |
| `--color-bg-3` | `#0d1320` | `#e6ebf0` | elevated surface |
| `--color-text` | `#f5f8ff` | `#0d1117` | headings / primary text |
| `--color-soft` | `#c9d4e4` | `#334155` | body text |
| `--color-muted` | `#9aa9bd` | `#5b6b7b` | captions / secondary |
| `--color-line` | `rgba(185,216,255,0.16)` | `rgba(15,23,42,0.12)` | borders |
| `--color-line-strong` | `rgba(185,216,255,0.28)` | `rgba(15,23,42,0.2)` | hover borders |
| `--color-panel` | `rgba(14,20,31,0.78)` | `rgba(255,255,255,0.72)` | glass panels |
| `--color-glow` | `rgba(72,216,255,0.14)` | `rgba(14,165,233,0.12)` | mouse glow |

Accent colors stay the same semantic meaning in both themes; only the base saturation is slightly dialed down in light mode for contrast.

---

## 4. Typography

| Element | Size | Line height | Weight | Notes |
|---------|------|-------------|--------|-------|
| H1 | 4.5rem (72px) | 0.96 | 800 | max-width ~11ch |
| H2 | 2.75rem (44px) | 1.05 | 800 | section headings |
| H3 | 1.375rem (22px) | 1.2 | 700 | card headings |
| Lead | 1.1875rem (19px) | 1.55 | 400 | hero description |
| Body | 1.0625rem (17px) | 1.55 | 400 | paragraphs |
| Small | 0.8125rem (13px) | 1.45 | 600 | labels, captions |
| Code | 0.8125rem (13px) | 1.5 | 400 | JetBrains Mono |

Tailwind classes:
- H1: `text-[4.5rem] leading-[0.96] font-extrabold`
- H2: `text-[2.75rem] leading-[1.05] font-extrabold`
- Body: `text-[1.0625rem] leading-relaxed`
- Code: `font-mono text-[0.8125rem]`

---

## 5. Spacing & Layout

- **Content max-width:** `1180px` (use `max-w-[1180px] mx-auto` or a custom wrapper `.wrapper`)
- **Horizontal page padding:** `16px` mobile / `24px` tablet / `32px` desktop
- **Section vertical padding:** `96px` desktop / `64px` mobile
- **Card grid gap:** `14px`
- **Rail gap:** `12px`
- **Section head margin-bottom:** `34px`

Wrapper class:

```css
.wrapper {
  width: min(1180px, calc(100% - 32px));
  margin-inline: auto;
}
@media (max-width: 640px) {
  .wrapper { width: min(1180px, calc(100% - 24px)); }
}
```

---

## 6. Glassmorphism Rules

All elevated surfaces share the same formula:

```css
.glass {
  background: var(--color-panel);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--color-line);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 20px 60px rgba(0,0,0,0.28);
}

[data-theme="light"] .glass {
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.6),
    0 20px 60px rgba(15,23,42,0.08);
}
```

Tailwind equivalent for a card:

```html
<div class="bg-panel border border-line rounded-2xl backdrop-blur-2xl shadow-2xl shadow-black/20 inset-shadow-white/5">
```

In light mode the same classes apply because the CSS variables are overridden by `[data-theme="light"]`.

---

## 7. Effects (Implementation Notes)

### 7.1 Animated Gradient Mesh (background)

A fixed, full-viewport layer behind content.

```html
<div class="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
  <div class="mesh absolute -inset-[25%] opacity-35"></div>
</div>
```

```css
.mesh {
  background:
    radial-gradient(circle at 20% 30%, rgba(72, 216, 255, 0.18), transparent 40%),
    radial-gradient(circle at 80% 20%, rgba(180, 140, 255, 0.14), transparent 45%),
    radial-gradient(circle at 60% 80%, rgba(94, 250, 213, 0.12), transparent 40%),
    radial-gradient(circle at 30% 70%, rgba(255, 206, 106, 0.10), transparent 45%),
    var(--color-bg);
  filter: blur(60px);
  animation: mesh 24s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .mesh { animation: none; opacity: 0.2; }
}
```

On mobile, keep the mesh but lower opacity to `0.2` and disable blur if needed for performance.

### 7.2 Mouse-Follow Radial Glow

Fixed overlay that follows the cursor.

```html
<div id="mouse-glow" class="fixed inset-0 pointer-events-none -z-[5]" aria-hidden="true"></div>
```

```css
#mouse-glow {
  background: radial-gradient(
    600px circle at var(--glow-x, 50%) var(--glow-y, 50%),
    var(--color-glow),
    transparent 40%
  );
}
```

```js
// src/main.js
const root = document.documentElement;
let glowRaf = null;
let nextX = 50;
let nextY = 50;

function onMove(e) {
  nextX = e.clientX;
  nextY = e.clientY;
  if (!glowRaf) {
    glowRaf = requestAnimationFrame(() => {
      root.style.setProperty('--glow-x', `${nextX}px`);
      root.style.setProperty('--glow-y', `${nextY}px`);
      glowRaf = null;
    });
  }
}

if (!window.matchMedia('(pointer: coarse)').matches) {
  document.addEventListener('mousemove', onMove, { passive: true });
}
```

### 7.3 Canvas Particle Network

A subtle network of connected dots.

```html
<canvas id="particle-network" class="fixed inset-0 pointer-events-none opacity-40 -z-[8]"></canvas>
```

Implementation sketch:

```js
const canvas = document.getElementById('particle-network');
const ctx = canvas.getContext('2d');
let particles = [];
const PARTICLE_COUNT = 48;
const CONNECT_DISTANCE = 120;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function initParticles() {
  particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 1.5 + 1,
  }));
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const lineColor = getComputedStyle(document.body).getPropertyValue('--color-line').trim();
  const textColor = getComputedStyle(document.body).getPropertyValue('--color-soft').trim();

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
    if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = textColor;
    ctx.fill();

    for (let j = i + 1; j < particles.length; j++) {
      const q = particles[j];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < CONNECT_DISTANCE) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.strokeStyle = lineColor;
        ctx.globalAlpha = 1 - d / CONNECT_DISTANCE;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  requestAnimationFrame(draw);
}

// Disable on touch / reduced motion
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;
if (!reduced && !coarse) {
  resize();
  initParticles();
  draw();
  window.addEventListener('resize', () => { resize(); initParticles(); });
  document.addEventListener('visibilitychange', () => {
    // pause/resume handled by not calling draw when hidden
  });
}
```

Note: on `visibilitychange` hidden, you can skip the `draw` loop entirely by guarding with a `running` boolean.

### 7.4 3D Card Tilt

Add to cards that should feel interactive: feature cards, workflow cards, install panel, use-case cards.

```html
<div class="tilt-card perspective-distant transform-3d" data-tilt>
  ...
</div>
```

```js
const tiltCards = document.querySelectorAll('[data-tilt]');

if (!window.matchMedia('(pointer: coarse)').matches) {
  tiltCards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const rx = ((y - cy) / cy) * -8; // max 8deg
      const ry = ((x - cx) / cx) * 8;
      card.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) scale3d(1.02, 1.02, 1.02)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'rotateX(0) rotateY(0) scale3d(1, 1, 1)';
    });
  });
}
```

```css
[data-tilt] {
  transition: transform 0.2s ease-out;
  transform-style: preserve-3d;
  will-change: transform;
}
```

### 7.5 Scroll Reveals

Use an IntersectionObserver to add `.is-visible`.

```css
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}

.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
```

Stagger children with CSS custom property:

```html
<div class="reveal" style="--reveal-index: 2">...</div>
```

```css
.reveal {
  transition-delay: calc(var(--reveal-index, 0) * 80ms);
}
```

```js
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.16, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
```

### 7.6 Terminal Typing Mockup

A small, fake terminal panel showing an UltraWork command.

```html
<div class="terminal glass rounded-2xl p-6 font-mono text-sm" data-terminal>
  <div class="flex gap-2 mb-4">
    <span class="w-3 h-3 rounded-full bg-rose"></span>
    <span class="w-3 h-3 rounded-full bg-amber"></span>
    <span class="w-3 h-3 rounded-full bg-emerald"></span>
  </div>
  <p class="text-soft">
    <span class="text-amber">$</span>
    <span class="terminal-text" data-typing></span>
    <span class="terminal-cursor animate-pulse">|</span>
  </p>
</div>
```

```js
const typeTargets = document.querySelectorAll('[data-typing]');
const commands = {
  ko: 'liora -p "/ultrawork 이 repo를 분석하고, 안전한 migration path를 찾아 구현하고 검증해줘."',
  en: 'liora -p "/ultrawork analyze this repo, find the safest migration path, implement and verify it."',
};

typeTargets.forEach(el => {
  const lang = el.closest('html')?.lang || 'en';
  const text = commands[lang] || commands.en;
  let i = 0;
  el.textContent = '';

  const step = () => {
    if (i <= text.length) {
      el.textContent = text.slice(0, i);
      i++;
      setTimeout(step, 45 + Math.random() * 30);
    }
  };

  // Start when scrolled into view
  const obs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      step();
      obs.disconnect();
    }
  }, { threshold: 0.5 });
  obs.observe(el);
});
```

### 7.7 Code Copy Buttons

Style buttons inside the install section code blocks.

```html
<div class="code-block glass rounded-xl bg-black/40 p-4 font-mono text-sm overflow-x-auto relative group">
  <button
    class="copy-btn absolute top-3 right-3 px-2 py-1 rounded-md text-xs border border-line bg-bg-2 text-soft opacity-0 group-hover:opacity-100 transition-opacity hover:border-cyan hover:text-cyan"
    data-copy="curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash"
    data-copied-ko="복사됨"
    data-copied-en="Copied"
    aria-label="Copy"
  >
    Copy
  </button>
  <span class="text-amber">$</span> curl -fsSL ...
</div>
```

```js
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.getAttribute('data-copy');
    if (!text || !navigator.clipboard) return;
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    const lang = document.documentElement.lang || 'en';
    btn.textContent = btn.getAttribute(`data-copied-${lang}`) || (lang === 'ko' ? '복사됨' : 'Copied');
    setTimeout(() => (btn.textContent = original), 1400);
  });
});
```

### 7.8 Manual Light / Dark Toggle

A button in the sticky nav. Default is dark. No `localStorage` / `sessionStorage` / cookies.

```html
<button id="theme-toggle" class="theme-toggle" aria-label="Toggle theme" type="button">
  <span class="icon-moon">...</span>
  <span class="icon-sun">...</span>
</button>
```

```js
const toggle = document.getElementById('theme-toggle');
const html = document.documentElement;

function updateIcon() {
  const isLight = html.getAttribute('data-theme') === 'light';
  toggle.setAttribute('aria-pressed', String(isLight));
  toggle.classList.toggle('is-light', isLight);
}

toggle.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  updateIcon();
});

updateIcon();
```

CSS for icons (show one at a time):

```css
.theme-toggle .icon-sun { display: none; }
.theme-toggle .icon-moon { display: block; }
.theme-toggle.is-light .icon-sun { display: block; }
.theme-toggle.is-light .icon-moon { display: none; }
```

---

## 8. HTML Section Map

Both `index.html` (KR) and `en/index.html` (EN) follow the same DOM structure.

```
body
├── #ambient
│   ├── .gradient-mesh
│   ├── #mouse-glow
│   └── #particle-network
├── header.nav
│   ├── .brand
│   ├── .nav-links
│   ├── .lang-switch
│   └── #theme-toggle
├── main
│   ├── section.hero
│   │   ├── .hero__copy
│   │   │   ├── .eyebrow
│   │   │   ├── h1
│   │   │   ├── p.hero__lead
│   │   │   └── .hero__actions
│   │   └── .hero__visual
│   │       ├── img (hero-command-center.png)
│   │       └── .hero__status
│   ├── section.problem
│   │   └── .problem-grid
│   ├── section.solution
│   │   ├── .solution-copy
│   │   └── .terminal
│   ├── section#ultra
│   │   ├── .section-head
│   │   ├── .split
│   │   │   ├── .rail
│   │   │   └── .media (ultra-orchestration.png)
│   │   └── .workflow
│   ├── section.proof
│   │   └── .proof-grid
│   ├── section.use-cases
│   │   └── .use-case-grid
│   ├── section#memory
│   │   └── .split
│   │       ├── .media (memory-wiki-themes.png)
│   │       └── .section-head
│   ├── section#themes
│   │   ├── .section-head
│   │   └── .showcase
│   │       ├── .media (agent-cockpit.png)
│   │       └── .theme-board
│   ├── section.capabilities
│   │   ├── .section-head
│   │   └── .feature-grid
│   └── section#install
│       └── .install
│           ├── .install-copy
│           └── .code-blocks
└── footer
    ├── .footer-copy
    └── .footer-links
```

Required narrative flow (AC4): **Hero → Problem → Solution → Ultra workflow → Proof → Use cases → Install → CTA**. The map above follows this exactly.

---

## 9. Component-Level Styling

### 9.1 Eyebrow Badge

```html
<div class="eyebrow inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan/25 bg-cyan/10 text-[13px] font-bold text-cyan/90">
  <span class="w-2 h-2 rounded-full bg-teal shadow-[0_0_12px_var(--color-teal)]"></span>
  Independent AI coding agent
</div>
```

### 9.2 Primary Button

```html
<a class="btn-primary inline-flex items-center justify-center h-12 px-5 rounded-xl font-extrabold text-[15px] bg-linear-[135deg] from-cyan via-teal to-amber text-bg" href="#install">
  Install now
</a>
```

### 9.3 Secondary Button

```html
<a class="btn-secondary inline-flex items-center justify-center h-12 px-5 rounded-xl font-extrabold text-[15px] border border-line-strong bg-white/4 text-text hover:border-cyan/60 hover:bg-cyan/10 transition" href="https://github.com/claudianus/superliora">
  View GitHub
</a>
```

### 9.4 Hero Visual

```html
<div class="hero-visual relative rounded-[28px] border border-line bg-bg-2 overflow-hidden shadow-2xl shadow-black/30">
  <img src="/hero-command-center.png" alt="..." class="w-full aspect-video object-cover">
  <div class="absolute inset-0 border border-white/10 rounded-[28px] pointer-events-none"></div>
  <div class="hero-status absolute left-4 right-4 bottom-4 grid grid-cols-3 gap-3">
    <!-- glass chips -->
  </div>
</div>
```

### 9.5 Proof Bar

Full-width bar with a 1px grid divider, using the `bg-line` color as the divider.

```html
<section class="proof w-full border-y border-line bg-bg-2">
  <div class="wrapper grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px">
    <div class="proof__item p-6 bg-bg-2">
      <span class="text-muted text-xs font-extrabold uppercase">Gate</span>
      <strong class="block mt-2 text-lg font-bold">UltraPlan</strong>
    </div>
    ...
  </div>
</section>
```

### 9.6 Feature Card

```html
<div class="feature-card glass rounded-2xl p-6 tilt-card" data-tilt style="--reveal-index: 0">
  <span class="text-amber text-sm font-black">01</span>
  <h3 class="mt-4 text-[22px] font-bold">Provider routing</h3>
  <p class="mt-3 text-muted">...</p>
</div>
```

### 9.7 Install Block

```html
<section class="install wrapper glass rounded-3xl p-8 md:p-10" id="install" data-tilt>
  <div class="grid lg:grid-cols-2 gap-8">
    <div>
      <div class="section-kicker text-teal text-sm font-black uppercase tracking-wide mb-2">Install</div>
      <h2 class="text-[2.75rem] leading-[1.05] font-extrabold">Install from source</h2>
      <p class="mt-4 text-soft text-[17px]">...</p>
    </div>
    <div class="space-y-3">
      <div class="code-block ...">...</div>
      <div class="code-block ...">...</div>
      <div class="code-block ...">...</div>
    </div>
  </div>
</section>
```

---

## 10. Responsive Behavior

| Breakpoint | Layout changes |
|------------|----------------|
| `< 640px` | Single column everywhere. Hero h1 42px. Nav collapses to brand + toggle only. Status chips stack. |
| `640px–1024px` | Hero 1 column. Proof/workflow 2 columns. |
| `> 1024px` | Full two-column hero and split sections. Feature grid 3 columns. Proof grid 6 columns. |

Key Tailwind breakpoints used: `sm:`, `md:`, `lg:`, `xl:`.

---

## 11. Accessibility & Performance

- **WCAG AA:** All text on glass panels must meet 4.5:1 contrast. Verify the muted text color against the panel background.
- **Reduced motion:** Respect `prefers-reduced-motion: reduce` by disabling the mesh animation, particle movement, scroll reveals, and 3D tilt.
- **Focus:** Ensure all buttons and links have visible focus rings (Tailwind `focus:outline-none focus:ring-2 focus:ring-cyan/50`).
- **Mobile motion:** Disable canvas particles and mouse glow on touch devices; keep only the gradient mesh (low opacity) and scroll reveals.
- **Images:** Use `loading="lazy"` for below-fold images; `hero-command-center.png` may be eager.
- **Font loading:** `display=swap` is already in the Google Fonts URL.

---

## 12. Implementation Checklist

- [x] `apps/site` created with Vite 6. `@tailwindcss/vite` plugin is present in `vite.config.ts`, but the shipped styles are written in vanilla CSS (`src/style.css`) rather than Tailwind utility classes.
- [x] `vite.config.ts` has `base: '/superliora/'` and multi-page `input` for `index.html` and `en/index.html`.
- [x] `package.json` scripts: `dev`, `build`, `preview`.
- [x] `public/assets/` contains the four existing PNGs.
- [~] `src/style.css` uses custom CSS properties and component classes instead of `@import "tailwindcss"` and `@theme` tokens. The original Tailwind-first design was replaced with a plain-CSS approach to simplify the single-page build and keep the file self-contained.
- [x] Korean `index.html` and English `en/index.html` follow the section map, with additional sections for visual debugging, premium TUI themes, and harness capabilities.
- [x] Animated gradient mesh implemented (`#ambient .mesh`).
- [x] Mouse-follow radial glow implemented (`#mouse-glow`), disabled on touch and reduced-motion devices.
- [x] Canvas particle network implemented (`#particle-network`), paused on `document.hidden` and disabled on touch/reduced-motion.
- [x] 3D card tilt implemented on cards with `data-tilt`.
- [x] Scroll reveals with `IntersectionObserver` adding `.is-visible`.
- [x] Terminal typing mockup in Solution and Harness sections.
- [x] Code copy buttons in Install section.
- [x] Manual light/dark toggle. **Deviation:** theme choice is persisted in `localStorage` so returning visitors keep their preference.
- [x] Chinese language files removed; no `zh/` links remain in the site.
- [ ] GitHub Actions workflow updated to build `apps/site` and deploy `dist/` (pending integration owner).
- [x] `flake.nix` and `pnpm-workspace.yaml` already include `apps/site`.
- [ ] Screenshots captured in both themes for verification (pending visual review).

