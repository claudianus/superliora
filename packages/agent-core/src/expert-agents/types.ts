export interface ExpertPersona {
  readonly id: string;
  readonly name: string;
  readonly division: string;
  readonly description: string;
  readonly color: string;
  readonly emoji: string;
  readonly vibe: string;
  readonly tags: readonly string[];
  readonly capabilities: readonly string[];
  readonly whenToUse: string;
  readonly personaText: string;
}

export interface ExpertCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly division: string;
  readonly divisionLabel: string;
  readonly divisionIcon: string;
  readonly divisionColor: string;
  readonly description: string;
  readonly color: string;
  readonly emoji: string;
  readonly vibe: string;
  readonly tags: readonly string[];
  readonly capabilities: readonly string[];
  readonly whenToUse: string;
  readonly personaText: string;
  readonly embedding?: readonly number[];
}

export interface ExpertSearchResult {
  readonly expert: ExpertCatalogEntry;
  readonly score: number;
}

export interface ExpertSwarmPlan {
  readonly taskDescription: string;
  readonly experts: readonly ExpertAssignment[];
  readonly strategy: 'parallel' | 'sequential' | 'mixed';
}

export interface ExpertAssignment {
  readonly expertId: string;
  readonly expertName: string;
  readonly prompt: string;
  readonly dependsOn?: readonly string[];
  readonly emoji: string;
  readonly color: string;
  readonly coverageLane?: string;
  readonly selectionReason?: string;
}

export interface UltraSwarmInput {
  readonly description: string;
  readonly experts?: readonly string[];
  readonly autoSelect?: boolean;
  readonly subagent_type?: string;
  readonly run_in_background?: boolean;
}
