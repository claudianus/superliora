import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { AnsiStage } from './AnsiStage';
import { CLUSTER_SCENE, loadSceneAnsi, type SceneId } from './scenes';

/** Dense real chrome first — sparse idle looks empty on a museum Stage. */
const HERO_PLAYLIST: SceneId[] = ['chrome-bands', 'job-deck', 'command-hub', 'status-route'];
const BEAT_MS = 4200;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Sticky museum Stage — scene follows the active cluster section via IntersectionObserver. */
export function ScrollLinkedStage() {
  const { t } = useI18n();
  const [sceneId, setSceneId] = useState<SceneId>('chrome-bands');
  const [ansi, setAnsi] = useState('');
  const [chapter, setChapter] = useState(0);
  const [inHero, setInHero] = useState(true);
  const heroIndexRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void loadSceneAnsi(sceneId).then((text) => {
      if (!cancelled) setAnsi(text);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  useEffect(() => {
    if (!inHero || prefersReducedMotion()) return;
    const id = window.setInterval(() => {
      heroIndexRef.current = (heroIndexRef.current + 1) % HERO_PLAYLIST.length;
      setSceneId(HERO_PLAYLIST[heroIndexRef.current]!);
    }, BEAT_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [inHero]);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-cluster]'));
    const hero = document.querySelector<HTMLElement>('[data-stage-hero]');
    if (nodes.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0];
        if (!top) return;
        if (top.target === hero) {
          setInHero(true);
          setChapter(0);
          setSceneId(HERO_PLAYLIST[heroIndexRef.current] ?? 'chrome-bands');
          return;
        }
        const cluster = (top.target as HTMLElement).dataset.cluster;
        if (!cluster) return;
        setInHero(false);
        const idx = t.clusters.items.findIndex((c) => c.id === cluster);
        setChapter(idx >= 0 ? idx + 1 : 0);
        setSceneId(CLUSTER_SCENE[cluster] ?? 'chrome-bands');
      },
      { rootMargin: '-18% 0px -42% 0px', threshold: [0.15, 0.4, 0.65] },
    );

    if (hero) obs.observe(hero);
    for (const node of nodes) obs.observe(node);
    return () => {
      obs.disconnect();
    };
  }, [t.clusters.items]);

  const caption =
    chapter === 0
      ? (t.theatre.beats.find((b) => b.id === sceneId)?.caption ?? t.hero.lead)
      : t.clusters.items[chapter - 1]?.lead;

  return (
    <div className={`museum-stage${inHero ? ' museum-stage--hero' : ''}`}>
      <AnsiStage ansi={ansi} sceneId={sceneId} caption={caption} />
      <div className="museum-stage__scrub" aria-hidden="true">
        {[0, ...t.clusters.items.map((_, i) => i + 1)].map((n) => (
          <span key={n} className={`scrub-dot ${chapter === n ? 'active' : ''}`} />
        ))}
      </div>
    </div>
  );
}
