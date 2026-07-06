/* SuperLiora site main.js — interactions, theme, reveals, particle network */

(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const root = document.documentElement;

  // Theme
  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('superliora-theme', theme); } catch {}
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }
  const savedTheme = (() => {
    try { return localStorage.getItem('superliora-theme'); } catch { return null; }
  })();
  const initialTheme = savedTheme || 'dark';
  setTheme(initialTheme);

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  // Reveal on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.setAttribute('aria-label', 'Copy command');
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add('copied');
        btn.setAttribute('aria-label', 'Copied');
        setTimeout(() => { btn.classList.remove('copied'); btn.setAttribute('aria-label', 'Copy command'); }, 1500);
      } catch {
        btn.setAttribute('aria-label', 'Copy failed');
      }
    });
  });

  // Mouse glow
  const glow = document.getElementById('mouse-glow');
  if (glow && !prefersReducedMotion) {
    let raf = 0;
    let mx = -1000, my = -1000;
    document.addEventListener('mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      glow.classList.add('active');
      if (raf) return;
      raf = requestAnimationFrame(() => {
        glow.style.left = mx + 'px';
        glow.style.top = my + 'px';
        raf = 0;
      });
    }, { passive: true });
    document.addEventListener('mouseleave', () => glow.classList.remove('active'));
  }

  // Particle network
  const canvas = document.getElementById('particle-network');
  if (canvas && !prefersReducedMotion) {
    const ctx = canvas.getContext('2d');
    let particles = [];
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      w = window.innerWidth; h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(Math.floor((w * h) / 28000), 80);
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.4 + 0.6
      }));
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, w, h);
      const lineColor = root.getAttribute('data-theme') === 'light' ? '102, 117, 138' : '0, 213, 255';
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${lineColor}, 0.35)`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x, dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 11000) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${lineColor}, ${0.12 * (1 - d2 / 11000)})`;
            ctx.lineWidth = 0.8;
            ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
      }
      frame = requestAnimationFrame(draw);
    }
    draw();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(frame); else draw();
    });
  }

  // Typing animations
  const typeEl = document.querySelector('[data-typing]');
  if (typeEl) {
    const lang = document.documentElement.lang || 'en';
    const phrases = {
      ko: 'liora -p "/ultrawork 홈페이지 히어로 섹션과 12개 기능 카드, 다크/라이트 테마를 구현해줘."',
      en: 'liora -p "/ultrawork build the homepage hero, 12 feature cards, and dark/light theme."'
    };
    const text = phrases[lang] || phrases.en;
    let i = 0;
    function step() {
      if (i <= text.length) {
        typeEl.textContent = text.slice(0, i);
        i++;
        setTimeout(step, 40 + Math.random() * 30);
      }
    }
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { step(); obs.disconnect(); }
    }, { threshold: 0.5 });
    obs.observe(typeEl);
  }

  // 3D tilt effect
  document.querySelectorAll('[data-tilt]').forEach((el) => {
    if (prefersReducedMotion || window.matchMedia('(pointer: coarse)').matches) return;
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.transform = `perspective(1000px) rotateX(${-y * 5}deg) rotateY(${x * 5}deg)`;
    }, { passive: true });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
  });

  // Smooth anchor offset for sticky nav
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        const y = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  });
})();
