export type SceneId =
  | 'idle-welcome'
  | 'chrome-bands'
  | 'job-deck'
  | 'command-hub'
  | 'model-picker'
  | 'status-route'
  | 'ask-mode'
  | 'inbox';

export interface SceneManifest {
  theme: string;
  hero: SceneId[];
  playlist: { cluster: string; scenes: SceneId[] }[];
  scenes: { id: SceneId; source: string; lines: number }[];
}

const cache = new Map<SceneId, string>();
let manifestPromise: Promise<SceneManifest> | null = null;

function framesBase(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}tui-frames`;
}

export async function loadSceneManifest(): Promise<SceneManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${framesBase()}/manifest.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`manifest ${String(res.status)}`);
        return res.json() as Promise<SceneManifest>;
      })
      .catch(() => ({
        theme: 'superliora-neon-noir',
        hero: ['idle-welcome', 'chrome-bands', 'job-deck', 'command-hub'],
        playlist: [
          { cluster: 'keep-going', scenes: ['status-route', 'model-picker'] },
          { cluster: 'see-fleet', scenes: ['chrome-bands', 'job-deck', 'inbox'] },
          { cluster: 'stay-control', scenes: ['ask-mode', 'inbox'] },
          { cluster: 'studio', scenes: ['command-hub', 'job-deck'] },
        ],
        scenes: [],
      }));
  }
  return manifestPromise;
}

export async function loadSceneAnsi(id: SceneId): Promise<string> {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const res = await fetch(`${framesBase()}/${id}.ansi`);
  if (!res.ok) {
    const txt = await fetch(`${framesBase()}/${id}.txt`);
    const body = txt.ok ? await txt.text() : `${id}`;
    cache.set(id, body);
    return body;
  }
  const ansi = await res.text();
  cache.set(id, ansi);
  return ansi;
}

export const CLUSTER_SCENE: Record<string, SceneId> = {
  'keep-going': 'status-route',
  'see-fleet': 'chrome-bands',
  'stay-control': 'ask-mode',
  studio: 'command-hub',
};
