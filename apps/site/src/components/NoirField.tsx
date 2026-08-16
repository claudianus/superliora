import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

const VERT = `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main(){ gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec2 u_mouse;
uniform float u_time;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.07; a *= 0.52; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  vec2 m = (u_mouse - 0.5) * 0.85;
  float t = u_time * 0.045;
  float n = fbm(p * 2.15 + m + vec2(t * 0.35, -t * 0.22));
  float w = fbm(p * 3.4 - m * 1.2 + vec2(-t * 0.5, t * 0.4));
  float ring = smoothstep(0.85, 0.12, length(p - m * 0.35));
  // #0D1422 Neon Noir base + deep navy — no white bleed
  vec3 bg = vec3(0.051, 0.078, 0.133);
  vec3 cyan = vec3(0.0, 0.835, 1.0);
  vec3 deep = vec3(0.024, 0.039, 0.071);
  vec3 col = mix(deep, bg, 0.72);
  col += cyan * pow(n, 2.1) * 0.42 * ring;
  col += cyan * pow(w, 2.8) * 0.12;
  col += cyan * exp(-5.5 * length(p - m * 0.55)) * 0.55;
  float vig = smoothstep(1.25, 0.25, length(p));
  o = vec4(col * vig, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.dataset.theme !== 'light';
}

function isForcedColors(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(forced-colors: active)').matches;
}

export function NoirField() {
  const reduce = usePrefersReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;
    let gl: WebGL2RenderingContext | null = null;
    let disposed = false;
    let onMove: ((e: PointerEvent) => void) | null = null;
    let observer: MutationObserver | null = null;
    let forcedMql: MediaQueryList | null = null;

    const stop = () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
      if (onMove) {
        window.removeEventListener('pointermove', onMove);
        onMove = null;
      }
      if (gl) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        gl = null;
      }
      canvas.hidden = true;
    };

    const start = () => {
      if (disposed) return;
      if (!isDarkTheme() || isForcedColors()) {
        stop();
        return;
      }
      if (gl) return;

      canvas.hidden = false;
      const ctx = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
      });
      if (!ctx) {
        canvas.hidden = true;
        return;
      }
      gl = ctx;

      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) {
        stop();
        return;
      }
      const prog = gl.createProgram();
      if (!prog) {
        stop();
        return;
      }
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        stop();
        return;
      }
      gl.useProgram(prog);

      const uRes = gl.getUniformLocation(prog, 'u_res');
      const uMouse = gl.getUniformLocation(prog, 'u_mouse');
      const uTime = gl.getUniformLocation(prog, 'u_time');
      const mouse = { x: 0.5, y: 0.35 };
      onMove = (e: PointerEvent) => {
        mouse.x = e.clientX / window.innerWidth;
        mouse.y = 1 - e.clientY / window.innerHeight;
      };
      window.addEventListener('pointermove', onMove, { passive: true });

      const started = performance.now();
      const resize = () => {
        if (!gl) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const w = Math.max(1, Math.floor(window.innerWidth * dpr));
        const h = Math.max(1, Math.floor(window.innerHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, w, h);
        }
      };

      const frame = (now: number) => {
        if (!gl || disposed) return;
        if (!isDarkTheme() || isForcedColors()) {
          stop();
          return;
        }
        resize();
        gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.uniform2f(uMouse, mouse.x, mouse.y);
        gl.uniform1f(uTime, reduce ? 0 : (now - started) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        raf = window.requestAnimationFrame(frame);
      };
      raf = window.requestAnimationFrame(frame);
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

  return <canvas ref={canvasRef} className="noir-field" aria-hidden="true" />;
}
