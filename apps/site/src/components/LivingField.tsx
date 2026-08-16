import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.dataset.theme !== 'light';
}

function isForcedColors(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(forced-colors: active)').matches;
}

export function LivingField() {
  const reduce = usePrefersReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;
    let disposed = false;
    let ctx: CanvasRenderingContext2D | null = null;
    let w = 0;
    let h = 0;
    let dots: Dot[] = [];
    let onMove: ((e: PointerEvent) => void) | null = null;
    let onLeave: (() => void) | null = null;
    let onResize: (() => void) | null = null;
    let observer: MutationObserver | null = null;
    let forcedMql: MediaQueryList | null = null;
    const mouse = { x: 0, y: 0, on: false };

    const stop = () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
      if (onMove) {
        window.removeEventListener('pointermove', onMove);
        onMove = null;
      }
      if (onLeave) {
        window.removeEventListener('pointerleave', onLeave);
        onLeave = null;
      }
      if (onResize) {
        window.removeEventListener('resize', onResize);
        onResize = null;
      }
      ctx = null;
      canvas.hidden = true;
    };

    const start = () => {
      if (disposed) return;
      if (!isDarkTheme() || isForcedColors()) {
        stop();
        return;
      }
      if (ctx) return;

      canvas.hidden = false;
      const next = canvas.getContext('2d', { alpha: true });
      if (!next) {
        canvas.hidden = true;
        return;
      }
      ctx = next;
      mouse.x = window.innerWidth * 0.62;
      mouse.y = window.innerHeight * 0.28;
      mouse.on = false;

      onMove = (e: PointerEvent) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.on = true;
      };
      onLeave = () => {
        mouse.on = false;
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerleave', onLeave);

      const resize = () => {
        if (!ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        canvas.style.width = `${String(w)}px`;
        canvas.style.height = `${String(h)}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const count = w < 640 ? 42 : w < 1100 ? 72 : 110;
        if (dots.length !== count) {
          dots = Array.from({ length: count }, () => ({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.35,
            vy: (Math.random() - 0.5) * 0.35,
          }));
        }
      };
      onResize = resize;
      resize();
      window.addEventListener('resize', resize, { passive: true });

      const tick = () => {
        if (!ctx || disposed) return;
        if (!isDarkTheme() || isForcedColors()) {
          stop();
          return;
        }
        ctx.clearRect(0, 0, w, h);
        const link = w < 640 ? 88 : 128;
        for (const d of dots) {
          if (!reduce) {
            d.x += d.vx;
            d.y += d.vy;
            if (d.x < 0 || d.x > w) d.vx *= -1;
            if (d.y < 0 || d.y > h) d.vy *= -1;
            d.x = Math.min(w, Math.max(0, d.x));
            d.y = Math.min(h, Math.max(0, d.y));
          }
          if (mouse.on) {
            const dx = mouse.x - d.x;
            const dy = mouse.y - d.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist < 280) {
              const pull = (1 - dist / 280) * (reduce ? 0.018 : 0.045);
              d.vx += (dx / dist) * pull;
              d.vy += (dy / dist) * pull;
            }
          }
          d.vx *= 0.985;
          d.vy *= 0.985;
        }

        ctx.lineWidth = 1;
        for (let i = 0; i < dots.length; i++) {
          const a = dots[i];
          if (!a) continue;
          for (let j = i + 1; j < dots.length; j++) {
            const b = dots[j];
            if (!b) continue;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist > link) continue;
            const alpha = (1 - dist / link) * 0.42;
            ctx.strokeStyle = `rgba(0, 213, 255, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        for (const d of dots) {
          const near = mouse.on ? Math.hypot(mouse.x - d.x, mouse.y - d.y) : 400;
          const glow = near < 180 ? 2.6 : 1.4;
          ctx.fillStyle = near < 180 ? 'rgba(125, 249, 255, 0.95)' : 'rgba(0, 213, 255, 0.72)';
          ctx.beginPath();
          ctx.arc(d.x, d.y, glow, 0, Math.PI * 2);
          ctx.fill();
        }

        if (mouse.on) {
          const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 140);
          g.addColorStop(0, 'rgba(0, 213, 255, 0.16)');
          g.addColorStop(1, 'rgba(0, 213, 255, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(mouse.x, mouse.y, 140, 0, Math.PI * 2);
          ctx.fill();
        }

        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    };

    const sync = () => {
      if (!isDarkTheme() || isForcedColors()) stop();
      else start();
    };

    sync();
    observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    if (window.matchMedia) {
      forcedMql = window.matchMedia('(forced-colors: active)');
      forcedMql.addEventListener('change', sync);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      forcedMql?.removeEventListener('change', sync);
      stop();
    };
  }, [reduce]);

  return <canvas ref={canvasRef} className="living-field" aria-hidden="true" data-living="on" />;
}
