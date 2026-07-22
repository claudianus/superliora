/**
 * GitGraph — branch and commit graph visualization.
 *
 * Provides a git history graph UI:
 * - Commit graph with branch lines
 * - Branch labels and colors
 * - HEAD indicator
 * - Tag markers
 * - Merge commit visualization
 * - Commit info (hash, author, message, date)
 * - Branch checkout indicators
 * - Remote tracking info
 * - Graph lane management
 * - Horizontal/vertical orientation
 *
 * Visual style:
 * ┌─ Git Graph ────────────────────────────────────────┐
 * │ *   a1b2c3d (HEAD -> main) Merge feature/login    │
 * │ |\                                                 │
 * │ | * d4e5f6a (feature/login) Add login form        │
 * │ | * g7h8i9j Add validation                        │
 * │ * | j0k1l2m (tag: v1.2.0) Release 1.2.0           │
 * │ |/                                                 │
 * │ *   m3n4o5p Initial commit                        │
 * │                                                    │
 * │ Branches: main, feature/login, develop            │
 * └────────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly author: string;
  readonly date: number;
  readonly parents: string[];
  readonly branches: string[];
  readonly tags: string[];
  readonly isHead?: boolean;
}

export interface GitBranch {
  readonly name: string;
  readonly color: string;
  readonly isRemote?: boolean;
  readonly headCommit: string;
}

export interface GraphNode {
  readonly commit: GitCommit;
  readonly lane: number;
  readonly row: number;
}

export interface GitGraphRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showBranchLabels?: boolean;
  readonly showTags?: boolean;
  readonly showAuthor?: boolean;
  readonly compactMode?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// GitGraph
// ---------------------------------------------------------------------------

const BRANCH_COLORS = ['primary', 'success', 'warning', 'accent', 'error', 'text'];
const GRAPH_CHARS = {
  commit: '●',
  merge: '◆',
  vertical: '│',
  branch: '├',
  mergeLeft: '┘',
  mergeRight: '┐',
  horizontal: '─',
};

export class GitGraph {
  private commits: Map<string, GitCommit> = new Map();
  private branches: Map<string, GitBranch> = new Map();
  private commitOrder: string[] = [];
  private graphNodes: GraphNode[] = [];
  private branchColorIdx = 0;

  // ─── Commit Management ───────────────────────────────────────────

  /** Add a commit. */
  addCommit(commit: GitCommit): void {
    this.commits.set(commit.hash, commit);
    this.commitOrder.unshift(commit.hash);

    // Auto-register branches
    for (const branch of commit.branches) {
      if (!this.branches.has(branch)) {
        this.addBranch(branch, commit.hash);
      }
    }
  }

  /** Add a branch. */
  addBranch(name: string, headCommit: string, isRemote = false): void {
    const color = BRANCH_COLORS[this.branchColorIdx % BRANCH_COLORS.length]!;
    this.branchColorIdx++;
    this.branches.set(name, { name, color, isRemote, headCommit });
  }

  /** Get a commit. */
  getCommit(hash: string): GitCommit | undefined {
    return this.commits.get(hash);
  }

  /** Get all commits in order. */
  getCommits(): GitCommit[] {
    return this.commitOrder.map((h) => this.commits.get(h)!).filter(Boolean);
  }

  /** Get all branches. */
  getBranches(): GitBranch[] {
    return [...this.branches.values()];
  }

  /** Get HEAD commit. */
  getHead(): GitCommit | undefined {
    return [...this.commits.values()].find((c) => c.isHead);
  }

  // ─── Graph Building ──────────────────────────────────────────────

  /** Build the graph layout. */
  buildGraph(): void {
    this.graphNodes = [];
    const activeLanes: (string | null)[] = [];

    for (let row = 0; row < this.commitOrder.length; row++) {
      const hash = this.commitOrder[row]!;
      const commit = this.commits.get(hash)!;

      // Find or create lane for this commit
      let lane = activeLanes.indexOf(hash);
      if (lane === -1) {
        // Find empty lane or create new
        lane = activeLanes.indexOf(null);
        if (lane === -1) {
          lane = activeLanes.length;
          activeLanes.push(null);
        }
      }

      activeLanes[lane] = hash;
      this.graphNodes.push({ commit, lane, row });

      // Handle parents
      if (commit.parents.length === 0) {
        // Root commit - close lane
        activeLanes[lane] = null;
      } else if (commit.parents.length === 1) {
        // Normal commit - continue lane
        activeLanes[lane] = commit.parents[0]!;
      } else {
        // Merge commit - first parent continues, others branch
        activeLanes[lane] = commit.parents[0]!;
        for (let i = 1; i < commit.parents.length; i++) {
          const emptyLane = activeLanes.indexOf(null);
          if (emptyLane !== -1) {
            activeLanes[emptyLane] = commit.parents[i]!;
          } else {
            activeLanes.push(commit.parents[i]!);
          }
        }
      }
    }
  }

  /** Get graph nodes. */
  getGraphNodes(): GraphNode[] {
    return this.graphNodes;
  }

  /** Get max lane count. */
  get maxLanes(): number {
    return Math.max(...this.graphNodes.map((n) => n.lane + 1), 1);
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the git graph. */
  render(options: GitGraphRenderOptions): string[] {
    const { width, height, showBranchLabels = true, showTags = true, showAuthor = false, compactMode = false, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header
    const title = ` Git Graph`;
    const branchCount = this.branches.size;
    lines.push(fg('textMuted', `┌─${boldFg('text', title)} ${'─'.repeat(Math.max(0, innerWidth - title.length - 18))} ${dimFg('textMuted', `${String(branchCount)} branches`)} ┐`));

    if (this.graphNodes.length === 0) {
      this.buildGraph();
    }

    // Render commits
    const maxCommits = height - 5;
    const laneWidth = 2;

    for (const node of this.graphNodes.slice(0, maxCommits)) {
      const { commit, lane } = node;
      const line = this.renderCommitLine(commit, lane, laneWidth, innerWidth, options);
      lines.push(fg('textMuted', '│') + line + fg('textMuted', '│'));

      // Connector line for merges
      if (commit.parents.length > 1 && !compactMode) {
        const connectorLine = this.renderConnector(lane, laneWidth, innerWidth, options);
        lines.push(fg('textMuted', '│') + connectorLine + fg('textMuted', '│'));
      }
    }

    // Pad
    while (lines.length < height - 2) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    // Footer with branches
    const branchNames = [...this.branches.keys()].slice(0, 4).join(', ');
    const footer = ` ${dimFg('textMuted', `Branches: ${branchNames}`)}`;
    lines.push(fg('textMuted', `└${padRight(footer, innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderCommitLine(commit: GitCommit, lane: number, laneWidth: number, width: number, options: GitGraphRenderOptions): string {
    const { fg, boldFg, dimFg } = options;

    // Graph portion
    let graph = '';
    for (let i = 0; i <= Math.max(lane, this.maxLanes - 1); i++) {
      if (i === lane) {
        // Commit node
        const isMerge = commit.parents.length > 1;
        const nodeChar = isMerge ? GRAPH_CHARS.merge : GRAPH_CHARS.commit;
        const branch = commit.branches[0];
        const color = branch ? this.branches.get(branch)?.color ?? 'text' : 'text';
        graph += fg(color, nodeChar) + ' ';
      } else if (i < lane) {
        // Check if there's an active line in this lane
        graph += dimFg('textMuted', `${GRAPH_CHARS.vertical} `);
      } else {
        graph += '  ';
      }
    }

    // Commit info
    const hashStr = dimFg('textMuted', commit.hash.slice(0, 7));
    const isHead = commit.isHead;

    // Refs (branches, tags, HEAD)
    let refs = '';
    if (isHead) {
      refs += fg('error', 'HEAD');
      if (commit.branches.length > 0) {
        refs += dimFg('textMuted', ' -> ');
      }
    }
    for (const branch of commit.branches) {
      const branchInfo = this.branches.get(branch);
      const color = branchInfo?.color ?? 'text';
      refs += fg(color, branch) + ' ';
    }
    for (const tag of commit.tags) {
      refs += fg('warning', `tag: ${tag}`) + ' ';
    }
    if (refs) {
      refs = dimFg('textMuted', '(') + refs.trim() + dimFg('textMuted', ') ');
    }

    const message = commit.message.slice(0, width - graph.length - 20);
    const messageStr = isHead ? boldFg('text', message) : fg('text', message);

    const line = `${graph}${hashStr} ${refs}${messageStr}`;
    return padRight(line, width);
  }

  private renderConnector(lane: number, laneWidth: number, width: number, options: GitGraphRenderOptions): string {
    const { dimFg } = options;
    let connector = '';
    for (let i = 0; i <= Math.max(lane, this.maxLanes - 1); i++) {
      if (i === lane) {
        connector += dimFg('textMuted', `${GRAPH_CHARS.branch}${GRAPH_CHARS.horizontal}`);
      } else if (i < lane) {
        connector += dimFg('textMuted', `${GRAPH_CHARS.vertical} `);
      } else {
        connector += '  ';
      }
    }
    return padRight(connector, width);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo git graph with sample history. */
export function createDemoGitGraph(): GitGraph {
  const graph = new GitGraph();
  const now = Date.now();

  // Create commits (newest first)
  graph.addCommit({
    hash: 'a1b2c3d',
    message: 'Merge feature/login into main',
    author: 'Alice',
    date: now - 3600000,
    parents: ['j0k1l2m', 'd4e5f6a'],
    branches: ['main'],
    tags: [],
    isHead: true,
  });

  graph.addCommit({
    hash: 'd4e5f6a',
    message: 'Add login form component',
    author: 'Bob',
    date: now - 7200000,
    parents: ['g7h8i9j'],
    branches: ['feature/login'],
    tags: [],
  });

  graph.addCommit({
    hash: 'g7h8i9j',
    message: 'Add form validation utils',
    author: 'Bob',
    date: now - 10800000,
    parents: ['j0k1l2m'],
    branches: [],
    tags: [],
  });

  graph.addCommit({
    hash: 'j0k1l2m',
    message: 'Release version 1.2.0',
    author: 'Alice',
    date: now - 86400000,
    parents: ['m3n4o5p'],
    branches: [],
    tags: ['v1.2.0'],
  });

  graph.addCommit({
    hash: 'm3n4o5p',
    message: 'Initial commit',
    author: 'Alice',
    date: now - 172800000,
    parents: [],
    branches: [],
    tags: [],
  });

  graph.addBranch('main', 'a1b2c3d');
  graph.addBranch('feature/login', 'd4e5f6a');
  graph.addBranch('develop', 'j0k1l2m');

  graph.buildGraph();

  return graph;
}
