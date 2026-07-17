import type { ExpertCatalogEntry, ExpertSearchResult, ExpertSwarmPlan } from './types';
import { globalExpertSearchEngine } from './search';
import { inferExpertTaskProfile } from './task-profile';
import { buildExpertAssignmentPrompt } from './expert-persona';

export interface TaskAnalysis {
  readonly domains: readonly string[];
  readonly complexity: 'simple' | 'medium' | 'complex';
  readonly suggestedExpertCount: number;
}

export interface UltraSwarmPlanOptions {
  readonly intensity?: 'balanced' | 'premium' | 'max';
  readonly maxExperts?: number;
}

export class UltraSwarmOrchestrator {
  addExpert(expert: ExpertCatalogEntry): void {
    globalExpertSearchEngine.addExpert(expert);
  }

  removeExpert(id: string): boolean {
    return globalExpertSearchEngine.removeExpert(id);
  }

  async analyzeTask(taskDescription: string): Promise<TaskAnalysis> {
    await globalExpertSearchEngine.initialize();

    // Extract potential domains by searching with keywords from the task
    const keywords = taskDescription
      .toLowerCase()
      .replaceAll(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const domainSet = new Set<string>();
    const seenExperts = new Set<string>();

    // Search with the full description first
    const fullResults = globalExpertSearchEngine.search({
      query: taskDescription,
      topK: 10,
      taskDescription,
    });
    for (const r of fullResults) {
      domainSet.add(r.expert.division);
      seenExperts.add(r.expert.id);
    }

    // Then search with individual keywords for broader coverage
    for (const keyword of keywords.slice(0, 5)) {
      const results = globalExpertSearchEngine.search({
        query: keyword,
        topK: 3,
        taskDescription,
      });
      for (const r of results) {
        if (!seenExperts.has(r.expert.id)) {
          domainSet.add(r.expert.division);
          seenExperts.add(r.expert.id);
        }
      }
    }

    const domains = Array.from(domainSet);
    const complexity =
      domains.length > 3 ? 'complex' : domains.length > 1 ? 'medium' : 'simple';
    const suggestedExpertCount = complexity === 'complex' ? 8 : complexity === 'medium' ? 5 : 3;

    return { domains, complexity, suggestedExpertCount };
  }

  async buildSwarmPlan(
    taskDescription: string,
    expertIds?: readonly string[],
    options: UltraSwarmPlanOptions = {},
  ): Promise<ExpertSwarmPlan> {
    await globalExpertSearchEngine.initialize();
    const taskProfile = inferExpertTaskProfile(taskDescription);

    let experts: ExpertSearchResult[];

    if (expertIds !== undefined && expertIds.length > 0) {
      // Explicit expert selection — fail closed on unknown ids (no silent filter).
      const missing: string[] = [];
      experts = [];
      for (const id of expertIds) {
        const expert = globalExpertSearchEngine.getExpertById(id);
        if (expert === undefined) {
          missing.push(id);
          continue;
        }
        experts.push({ expert, score: 1 });
      }
      if (missing.length > 0) {
        throw new Error(
          `Unknown expert id(s): ${missing.join(', ')}. Pass catalog expert ids or omit expertIds for auto-select.`,
        );
      }
    } else {
      // Auto-select experts based on task analysis
      const analysis = await this.analyzeTask(taskDescription);
      const targetExpertCount = targetExpertCountForAnalysis(analysis, options);
      experts = [];
      const seen = new Set<string>();

      for (const lane of requiredCoverageLanes(taskDescription, options.intensity)) {
        const laneExperts = globalExpertSearchEngine.search({
          query: `${taskDescription} ${coverageLaneQuery(lane)}`,
          topK: 8,
          taskDescription,
          filter: (expert) => coverageLaneForExpert(expert, taskDescription) === lane,
        });
        for (const e of laneExperts) {
          if (seen.has(e.expert.id)) continue;
          experts.push(e);
          seen.add(e.expert.id);
          break;
        }
        if (experts.length >= targetExpertCount) break;
      }

      for (const domain of analysis.domains) {
        if (taskProfile.excludedDivisions.includes(domain)) continue;
        const domainExperts = globalExpertSearchEngine.search({
          query: taskDescription,
          topK: 1,
          division: domain,
          taskDescription,
        });
        for (const e of domainExperts) {
          if (!seen.has(e.expert.id)) {
            experts.push(e);
            seen.add(e.expert.id);
          }
          if (experts.length >= targetExpertCount) break;
        }
        if (experts.length >= targetExpertCount) break;
      }

      // If we still don't have enough, do a broad search
      if (experts.length < targetExpertCount) {
        const broad = globalExpertSearchEngine.search({
          query: taskDescription,
          topK: targetExpertCount + 8,
          taskDescription,
        });
        for (const e of broad) {
          if (!seen.has(e.expert.id)) {
            experts.push(e);
            seen.add(e.expert.id);
          }
          if (experts.length >= targetExpertCount) break;
        }
      }
    }

    const strategy: ExpertSwarmPlan['strategy'] =
      experts.length > 3 ? 'mixed' : experts.length > 1 ? 'parallel' : 'sequential';

    const assignments = experts.map((result, index) => {
      const prev = experts[index - 1];
      return {
        expertId: result.expert.id,
        expertName: result.expert.name,
        division: result.expert.division,
        divisionLabel: result.expert.divisionLabel,
        emoji: result.expert.emoji,
        color: result.expert.color,
        prompt: this.buildExpertPrompt(result.expert, taskDescription, index, experts.length),
        dependsOn: strategy === 'sequential' && index > 0 && prev !== undefined ? [prev.expert.id] : undefined,
        coverageLane: coverageLaneForExpert(result.expert, taskDescription),
        selectionReason: selectionReasonForExpert(result.expert),
      };
    });

    return {
      taskDescription,
      experts: assignments,
      strategy,
    };
  }

  private buildExpertPrompt(
    expert: ExpertCatalogEntry,
    taskDescription: string,
    index: number,
    totalExperts: number,
  ): string {
    return buildExpertAssignmentPrompt(expert, {
      taskDescription,
      swarmIndex: index,
      totalExperts,
    });
  }
}

export const globalUltraSwarmOrchestrator = new UltraSwarmOrchestrator();

function targetExpertCountForAnalysis(
  analysis: TaskAnalysis,
  options: UltraSwarmPlanOptions,
): number {
  const maxExperts = options.maxExperts ?? Number.POSITIVE_INFINITY;
  const intensity = options.intensity ?? 'balanced';
  if (intensity === 'max') {
    return Math.max(analysis.suggestedExpertCount, Math.min(maxExperts, 12));
  }
  if (intensity === 'premium') {
    return Math.min(maxExperts, Math.max(analysis.suggestedExpertCount, 6));
  }
  return Math.min(maxExperts, Math.max(analysis.suggestedExpertCount, 3));
}

function requiredCoverageLanes(
  taskDescription: string,
  intensity: UltraSwarmPlanOptions['intensity'],
): readonly string[] {
  const taskText = taskDescription.toLowerCase();
  const lanes = [
    'product_requirements',
    'architecture_implementation',
    'testing_evidence',
  ];
  if (intensity === 'premium' || intensity === 'max') {
    lanes.push('performance_reliability');
  }
  if (intensity === 'premium' || intensity === 'max' || /\b(?:ui|ux|visual|tui|frontend|design|game)\b/.test(taskText)) {
    lanes.push('ux_visual_content');
  }
  if (intensity === 'max' || /\b(?:security|auth|privacy|payment|permission|credential|secret)\b/.test(taskText)) {
    lanes.push('security_privacy');
  }
  if (intensity === 'max' || /\b(?:research|paper|latest|web|docs|source)\b/.test(taskText)) {
    lanes.push('domain_subject_matter');
  }
  return lanes;
}

function coverageLaneQuery(lane: string): string {
  const queries: Record<string, string> = {
    product_requirements: 'product manager requirements scope acceptance criteria',
    architecture_implementation: 'software architect implementation engineer code design',
    testing_evidence: 'qa testing verification evidence reviewer',
    performance_reliability: 'performance reliability scale latency benchmark',
    ux_visual_content: 'ux ui visual design frontend tui interface',
    security_privacy: 'security privacy auth permissions risk review',
    domain_subject_matter: 'research domain expert latest evidence documentation',
  };
  return queries[lane] ?? lane;
}

function coverageLaneForExpert(expert: ExpertCatalogEntry, taskDescription: string): string {
  const division = expert.division.toLowerCase();
  const expertText = `${expert.name} ${expert.description} ${expert.tags.join(' ')} ${expert.capabilities.join(' ')}`.toLowerCase();

  switch (division) {
    case 'testing':
      return 'testing_evidence';
    case 'product':
    case 'project-management':
      return 'product_requirements';
    case 'engineering':
      return 'architecture_implementation';
    case 'design':
      return 'ux_visual_content';
    case 'security':
      return 'security_privacy';
    case 'sales':
    case 'marketing':
    case 'paid-media':
    case 'finance':
    case 'support':
    case 'academic':
    case 'gis':
    case 'specialized':
      return 'domain_subject_matter';
    case 'spatial-computing':
      if (/\b(?:terminal|tui|cli|renderer|interface|ui|ux)\b/.test(expertText)) {
        return 'ux_visual_content';
      }
      return 'architecture_implementation';
    case 'game-development':
      return 'ux_visual_content';
    default:
      break;
  }

  const taskText = taskDescription.toLowerCase();
  if (/\b(?:security|auth|privacy|payment|compliance|legal)\b/.test(expertText)) return 'security_privacy';
  if (/\b(?:test|testing|qa|quality|verification|validation|evidence)\b/.test(expertText)) return 'testing_evidence';
  if (/\b(?:performance|latency|scale|reliability|benchmark)\b/.test(expertText)) return 'performance_reliability';
  if (/\b(?:design|visual|brand|ux|ui|motion|animation|terminal|tui|cli)\b/.test(expertText)) return 'ux_visual_content';
  if (/\b(?:engineer|engineering|architect|software|developer|implementation|code)\b/.test(expertText)) {
    return 'architecture_implementation';
  }
  if (/\b(?:security|auth|privacy|payment|compliance|legal)\b/.test(taskText)) return 'security_privacy';
  if (/\b(?:design|visual|brand|ux|ui|motion|game|animation|tui|terminal|cli)\b/.test(taskText)) {
    return 'ux_visual_content';
  }
  if (/\b(?:test|qa|quality|review|verification|validation)\b/.test(taskText)) return 'testing_evidence';
  if (/\b(?:performance|latency|scale|reliability|benchmark)\b/.test(taskText)) return 'performance_reliability';
  return 'architecture_implementation';
}

function selectionReasonForExpert(expert: ExpertCatalogEntry): string {
  const description = expert.description.trim();
  if (description.length > 0) return description;
  const tags = expert.tags.slice(0, 5).join(', ');
  return tags.length > 0
    ? `Selected for ${expert.divisionLabel} coverage: ${tags}.`
    : `Selected for ${expert.divisionLabel} coverage.`;
}
