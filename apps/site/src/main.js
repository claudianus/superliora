/**
 * SuperLiora landing site effects
 * - Manual light/dark toggle (no persistence)
 * - Mouse-follow radial glow (desktop only)
 * - Canvas particle network (desktop only, reduced-motion aware)
 * - 3D card tilt on hover
 * - Scroll-triggered reveals
 * - Terminal typing mockup
 * - Code-copy buttons
 */

const root = document.documentElement;
const html = document.documentElement;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isCoarse = window.matchMedia('(pointer: coarse)').matches;

// Default to dark theme. Toggle removes .dark to show light CSS defaults.
if (!html.classList.contains('dark') && !html.classList.contains('light')) {
  html.classList.add('dark');
}

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
function updateThemeIcon() {
  const isDark = html.classList.contains('dark');
  themeToggle?.setAttribute('aria-pressed', String(isDark));
  themeToggle?.classList.toggle('is-light', !isDark);
}

if (themeToggle) {
  updateThemeIcon();
  themeToggle.addEventListener('click', () => {
    html.classList.toggle('dark');
    updateThemeIcon();
  });
}

// Mouse-follow radial glow
let glowRaf = null;
let nextGlowX = window.innerWidth / 2;
let nextGlowY = window.innerHeight / 2;

function scheduleGlow() {
  if (glowRaf) return;
  glowRaf = requestAnimationFrame(() => {
    root.style.setProperty('--glow-x', `${nextGlowX}px`);
    root.style.setProperty('--glow-y', `${nextGlowY}px`);
    glowRaf = null;
  });
}

if (!isCoarse && !prefersReducedMotion) {
  document.addEventListener('mousemove', (e) => {
    nextGlowX = e.clientX;
    nextGlowY = e.clientY;
    scheduleGlow();
  }, { passive: true });
  scheduleGlow();
}

// Canvas particle network
const particleCanvas = document.getElementById('particle-network');
const PARTICLE_COUNT = 48;
const CONNECT_DISTANCE = 120;
let particles = [];
let ctx = null;
let particleRunning = false;
let particleFrame = null;

function resizeParticles() {
  if (!particleCanvas) return;
  particleCanvas.width = window.innerWidth;
  particleCanvas.height = window.innerHeight;
}

function initParticles() {
  if (!particleCanvas) return;
  const w = particleCanvas.width;
  const h = particleCanvas.height;
  particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 1.5 + 1,
  }));
}

function parseCssColor(name) {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  if (value.startsWith('rgba')) {
    return value;
  }
  if (value.startsWith('#')) {
    return value;
  }
  return value || '#9aa9bd';
}

function drawParticles() {
  if (!particleCanvas || !ctx || !particleRunning) return;
  const w = particleCanvas.width;
  const h = particleCanvas.height;
  const lineColor = parseCssColor('--color-line');
  const dotColor = parseCssColor('--color-soft');

  ctx.clearRect(0, 0, w, h);

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > w) p.vx *= -1;
    if (p.y < 0 || p.y > h) p.vy *= -1;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
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

  particleFrame = requestAnimationFrame(drawParticles);
}

function startParticles() {
  if (!particleCanvas || prefersReducedMotion || isCoarse) return;
  ctx = particleCanvas.getContext('2d');
  resizeParticles();
  initParticles();
  particleRunning = true;
  drawParticles();

  window.addEventListener('resize', () => {
    resizeParticles();
    initParticles();
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    particleRunning = !document.hidden;
    if (particleRunning && !particleFrame) {
      drawParticles();
    }
  });
}

startParticles();

// 3D card tilt
if (!isCoarse && !prefersReducedMotion) {
  document.querySelectorAll('[data-tilt]').forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const rx = ((y - cy) / cy) * -8;
      const ry = ((x - cx) / cx) * 8;
      card.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) scale3d(1.02, 1.02, 1.02)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'rotateX(0) rotateY(0) scale3d(1, 1, 1)';
    });
  });
}

// Scroll reveals
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.16, rootMargin: '0px 0px -40px 0px' },
);

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

// Terminal typing mockup
const commands = {
  ko: 'liora -p "/ultrawork 이 repo를 분석하고, 안전한 migration path를 찾아 구현하고 검증해줘."',
  en: 'liora -p "/ultrawork analyze this repo, find the safest migration path, implement and verify it."',
};

document.querySelectorAll('[data-typing]').forEach((el) => {
  const lang = document.documentElement.lang || 'en';
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

  const obs = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        step();
        obs.disconnect();
      }
    },
    { threshold: 0.5 },
  );
  obs.observe(el);
});

// Code copy buttons
function copyLabel(lang) {
  return lang === 'ko' ? '복사' : 'Copy';
}

function copiedLabel(lang) {
  return lang === 'ko' ? '복사됨' : 'Copied';
}

// Initialize labels based on language
document.querySelectorAll('.copy-btn').forEach((btn) => {
  const lang = document.documentElement.lang || 'en';
  btn.textContent = copyLabel(lang);

  btn.addEventListener('click', async () => {
    const text = btn.getAttribute('data-copy');
    if (!text || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      const lang = document.documentElement.lang || 'en';
      btn.textContent = copiedLabel(lang);
      setTimeout(() => (btn.textContent = original), 1400);
    } catch {
      // ignore
    }
  });
});
