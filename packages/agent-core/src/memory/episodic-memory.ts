/**
 * Episodic memory: persistent, cross-session storage of task episodes —
 * context, outcome, and insights — inspired by Hermes Agent's MEMORY.md pattern.
 *
 * Unlike semantic memory (facts) or procedural memory (skills), episodic
 * memory captures *what happened* during a task: the goal, steps, outcome,
 * and any insights discovered. This enables learning from past sessions.
 *
 * Storage: JSON files under `<brandHomeDir>/memory/episodes/` for persistence
 * across sessions. Loaded on startup and queried via search.
 */

import { promises as fs } from 'node:fs';
import path from 'pathe';
import { createHash } from 'node:crypto';

export interface Episode {
  readonly id: string;
  readonly createdAt: string;
  readonly session_id?: string;
  readonly workDir: string;
  readonly goal: string;
  readonly steps: readonly EpisodeStep[];
  readonly outcome: 'success' | 'failure' | 'partial' | 'interrupted';
  readonly insights: readonly string[];
  readonly tags: readonly string[];
  readonly contentHash: string;
}

export interface EpisodeStep {
  readonly description: string;
  readonly toolName?: string;
  readonly success: boolean;
  readonly error?: string;
}

export interface EpisodicMemoryStore {
  readonly episodes: readonly Episode[];
  add(episode: Episode): Promise<void>;
  search(query: string, limit?: number): readonly Episode[];
  getByTag(tag: string): readonly Episode[];
  getByWorkDir(workDir: string): readonly Episode[];
}

export interface EpisodicMemoryOptions {
  readonly storageDir: string;
  readonly mkdir?: typeof fs.mkdir;
  readonly readFile?: typeof fs.readFile;
  readonly writeFile?: typeof fs.writeFile;
  readonly readdir?: typeof fs.readdir;
  readonly unlink?: typeof fs.unlink;
}

/**
 * Create a new episode record.
 */
export function createEpisode(input: {
  session_id?: string;
  workDir: string;
  goal: string;
  steps?: readonly EpisodeStep[];
  outcome: Episode['outcome'];
  insights?: readonly string[];
  tags?: readonly string[];
}): Episode {
  const steps = input.steps ?? [];
  const insights = input.insights ?? [];
  const tags = input.tags ?? [];
  const contentHash = episodeContentHash(input.goal, steps, insights);
  return {
    id: contentHash,
    createdAt: new Date().toISOString(),
    session_id: input.session_id,
    workDir: input.workDir,
    goal: input.goal,
    steps,
    outcome: input.outcome,
    insights,
    tags,
    contentHash,
  };
}

function episodeContentHash(
  goal: string,
  steps: readonly EpisodeStep[],
  insights: readonly string[],
): string {
  const content = JSON.stringify({ goal, steps, insights });
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * File-based episodic memory store. Persists episodes as JSON files.
 */
export class FileEpisodicMemoryStore implements EpisodicMemoryStore {
  private readonly episodeMap = new Map<string, Episode>();
  private readonly opts: Required<EpisodicMemoryOptions>;
  private loaded = false;

  constructor(options: EpisodicMemoryOptions) {
    this.opts = {
      storageDir: options.storageDir,
      mkdir: options.mkdir ?? fs.mkdir,
      readFile: options.readFile ?? fs.readFile,
      writeFile: options.writeFile ?? fs.writeFile,
      readdir: options.readdir ?? fs.readdir,
      unlink: options.unlink ?? fs.unlink,
    };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const files = await this.opts.readdir(this.opts.storageDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(this.opts.storageDir, file);
        try {
          const content = await this.opts.readFile(filePath, 'utf-8');
          const episode = JSON.parse(content) as Episode;
          this.episodeMap.set(episode.id, episode);
        } catch {
          // Skip corrupted files
        }
      }
    } catch {
      // Directory doesn't exist yet — no episodes to load
    }
  }

  get episodes(): readonly Episode[] {
    const list = Array.from(this.episodeMap.values());
    return list.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async add(episode: Episode): Promise<void> {
    await this.load();
    // Skip if already stored (same content hash)
    if (this.episodeMap.has(episode.id)) return;
    this.episodeMap.set(episode.id, episode);
    await this.opts.mkdir(this.opts.storageDir, { recursive: true });
    const filePath = path.join(this.opts.storageDir, `${episode.id}.json`);
    await this.opts.writeFile(filePath, JSON.stringify(episode, null, 2), 'utf-8');
  }

  search(query: string, limit: number = 5): readonly Episode[] {
    const lowerQuery = query.toLowerCase();
    const queryTerms = lowerQuery.split(/\s+/).filter((t) => t.length > 0);
    if (queryTerms.length === 0) return [];

    const scored: { episode: Episode; score: number }[] = [];
    for (const episode of this.episodeMap.values()) {
      const searchable = [
        episode.goal,
        episode.outcome,
        ...episode.insights,
        ...episode.tags,
        ...episode.steps.map((s) => s.description),
      ].join(' ').toLowerCase();

      const score = queryTerms.reduce(
        (sum, term) => sum + (searchable.includes(term) ? 1 : 0),
        0,
      );
      if (score > 0) {
        scored.push({ episode, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.episode);
  }

  getByTag(tag: string): readonly Episode[] {
    const lowerTag = tag.toLowerCase();
    return Array.from(this.episodeMap.values()).filter((e) =>
      e.tags.some((t) => t.toLowerCase() === lowerTag),
    );
  }

  getByWorkDir(workDir: string): readonly Episode[] {
    return Array.from(this.episodeMap.values()).filter((e) => e.workDir === workDir);
  }
}

/**
 * Render episodes as a context section for injection into prompts.
 */
export function renderEpisodicMemorySection(episodes: readonly Episode[]): string {
  if (episodes.length === 0) return '';
  const lines = ['past_episodes:'];
  for (const episode of episodes) {
    lines.push(`- id=${episode.id} outcome=${episode.outcome}`);
    lines.push(`  goal: ${episode.goal}`);
    if (episode.insights.length > 0) {
      lines.push(`  insights:`);
      for (const insight of episode.insights) {
        lines.push(`    - ${insight}`);
      }
    }
    if (episode.tags.length > 0) {
      lines.push(`  tags: ${episode.tags.join(', ')}`);
    }
  }
  return lines.join('\n');
}