import type { ExpertCatalogEntry, ExpertSearchResult, ExpertSwarmPlan } from './types';
import { globalExpertSearchEngine } from './search';

export interface TaskAnalysis {
  readonly domains: readonly string[];
  readonly complexity: 'simple' | 'medium' | 'complex';
  readonly suggestedExpertCount: number;
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
    const fullResults = globalExpertSearchEngine.search({ query: taskDescription, topK: 10 });
    for (const r of fullResults) {
      domainSet.add(r.expert.division);
      seenExperts.add(r.expert.id);
    }

    // Then search with individual keywords for broader coverage
    for (const keyword of keywords.slice(0, 5)) {
      const results = globalExpertSearchEngine.search({ query: keyword, topK: 3 });
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
    const suggestedExpertCount = complexity === 'complex' ? 5 : complexity === 'medium' ? 3 : 1;

    return { domains, complexity, suggestedExpertCount };
  }

  async buildSwarmPlan(
    taskDescription: string,
    expertIds?: readonly string[],
  ): Promise<ExpertSwarmPlan> {
    await globalExpertSearchEngine.initialize();

    let experts: ExpertSearchResult[];

    if (expertIds !== undefined && expertIds.length > 0) {
      // Explicit expert selection
      experts = expertIds
        .map((id) => {
          const expert = globalExpertSearchEngine.getExpertById(id);
          return expert !== undefined ? { expert, score: 1 } : undefined;
        })
        .filter((e): e is ExpertSearchResult => e !== undefined);
    } else {
      // Auto-select experts based on task analysis
      const analysis = await this.analyzeTask(taskDescription);
      experts = [];
      const seen = new Set<string>();

      for (const domain of analysis.domains) {
        const domainExperts = globalExpertSearchEngine.search({
          query: taskDescription,
          topK: 1,
          division: domain,
        });
        for (const e of domainExperts) {
          if (!seen.has(e.expert.id)) {
            experts.push(e);
            seen.add(e.expert.id);
          }
          if (experts.length >= analysis.suggestedExpertCount) break;
        }
        if (experts.length >= analysis.suggestedExpertCount) break;
      }

      // If we still don't have enough, do a broad search
      if (experts.length < analysis.suggestedExpertCount) {
        const broad = globalExpertSearchEngine.search({
          query: taskDescription,
          topK: analysis.suggestedExpertCount + 3,
        });
        for (const e of broad) {
          if (!seen.has(e.expert.id)) {
            experts.push(e);
            seen.add(e.expert.id);
          }
          if (experts.length >= analysis.suggestedExpertCount) break;
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
        emoji: result.expert.emoji,
        color: result.expert.color,
        prompt: this.buildExpertPrompt(result.expert, taskDescription, index),
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

  private buildExpertPrompt(expert: ExpertCatalogEntry, taskDescription: string, index: number): string {
    const base = `You are ${expert.name} (${expert.emoji}), the "${expert.id}" expert subagent.`;
    const context = index === 0
      ? `You have been summoned as part of an UltraSwarm to tackle this task:\n\n${taskDescription}\n\nFocus on your specific expertise and provide a detailed, high-quality contribution.`
      : `You are working alongside other experts on this task:\n\n${taskDescription}\n\nFocus on your specific expertise. Your work may build on or complement the work of other experts in the swarm.`;
    return `${base}\n\n---\n\n${context}`;
  }
}

export const globalUltraSwarmOrchestrator = new UltraSwarmOrchestrator();

function coverageLaneForExpert(expert: ExpertCatalogEntry, taskDescription: string): string {
  const expertText = `${expert.division} ${expert.divisionLabel} ${expert.name} ${expert.description} ${expert.tags.join(' ')}`.toLowerCase();
  const taskText = taskDescription.toLowerCase();
  if (/\b(?:security|auth|privacy|payment|compliance|legal)\b/.test(expertText)) return 'security_privacy';
  if (/\b(?:design|visual|brand|ux|ui|motion|animation)\b/.test(expertText)) return 'ux_visual_content';
  if (/\b(?:test|qa|quality|verification|validation)\b/.test(expertText)) return 'testing_evidence';
  if (/\b(?:performance|latency|scale|reliability|benchmark)\b/.test(expertText)) return 'performance_reliability';
  if (/\b(?:product|project|manager|requirements|strategy)\b/.test(expertText)) return 'product_requirements';
  if (/\b(?:academic|finance|gis|game|marketing|sales|support|specialized)\b/.test(expertText)) return 'domain_subject_matter';
  if (/\b(?:security|auth|privacy|payment|compliance|legal)\b/.test(taskText)) return 'security_privacy';
  if (/\b(?:design|visual|brand|ux|ui|motion|game|animation)\b/.test(taskText)) return 'ux_visual_content';
  if (/\b(?:test|qa|quality|review|verification|validation)\b/.test(taskText)) return 'testing_evidence';
  if (/\b(?:performance|latency|scale|reliability|benchmark)\b/.test(taskText)) return 'performance_reliability';
  if (/\b(?:product|project|manager|requirements|strategy)\b/.test(taskText)) return 'product_requirements';
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
