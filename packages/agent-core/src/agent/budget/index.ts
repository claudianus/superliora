/**
 * Dynamic token budget allocation for context window management.
 *
 * Allocates tokens across different context components based on
 * task complexity and available context window size.
 */

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export interface TokenBudget {
  /** Tokens allocated for system prompt */
  systemPrompt: number;
  /** Tokens allocated for tool definitions */
  toolDefinitions: number;
  /** Tokens allocated for conversation history */
  conversationHistory: number;
  /** Tokens reserved for model response */
  reservedForResponse: number;
  /** Total context window size */
  total: number;
}

export interface TokenBudgetConfig {
  /** Maximum context window tokens */
  maxContextTokens: number;
  /** Minimum tokens to reserve for response (default: 4000) */
  minResponseReserve?: number;
  /** Maximum tokens for system prompt (default: 6000) */
  maxSystemPromptTokens?: number;
  /** Maximum tokens for tool definitions (default: 12000) */
  maxToolDefinitionTokens?: number;
}

const DEFAULT_MIN_RESPONSE_RESERVE = 4000;
const DEFAULT_MAX_SYSTEM_PROMPT_TOKENS = 6000;
const DEFAULT_MAX_TOOL_DEFINITION_TOKENS = 12000;

/**
 * Manages dynamic token budget allocation.
 */
export class TokenBudgetManager {
  private readonly maxContextTokens: number;
  private readonly minResponseReserve: number;
  private readonly maxSystemPromptTokens: number;
  private readonly maxToolDefinitionTokens: number;

  constructor(config: TokenBudgetConfig) {
    this.maxContextTokens = config.maxContextTokens;
    this.minResponseReserve = config.minResponseReserve ?? DEFAULT_MIN_RESPONSE_RESERVE;
    this.maxSystemPromptTokens = config.maxSystemPromptTokens ?? DEFAULT_MAX_SYSTEM_PROMPT_TOKENS;
    this.maxToolDefinitionTokens = config.maxToolDefinitionTokens ?? DEFAULT_MAX_TOOL_DEFINITION_TOKENS;
  }

  /**
   * Allocate token budget based on task complexity.
   */
  allocate(complexity: TaskComplexity = 'moderate'): TokenBudget {
    // Base allocations
    const systemPrompt = this.resolveSystemPromptBudget(complexity);
    const toolDefinitions = this.resolveToolDefinitionBudget(complexity);
    const reservedForResponse = this.resolveResponseBudget(complexity);

    // Remaining tokens go to conversation history
    const conversationHistory = Math.max(
      0,
      this.maxContextTokens - systemPrompt - toolDefinitions - reservedForResponse,
    );

    return {
      systemPrompt,
      toolDefinitions,
      conversationHistory,
      reservedForResponse,
      total: this.maxContextTokens,
    };
  }

  /**
   * Resolve system prompt budget based on complexity.
   */
  private resolveSystemPromptBudget(complexity: TaskComplexity): number {
    switch (complexity) {
      case 'simple':
        return Math.min(3000, this.maxSystemPromptTokens);
      case 'moderate':
        return Math.min(4500, this.maxSystemPromptTokens);
      case 'complex':
        return this.maxSystemPromptTokens;
    }
  }

  /**
   * Resolve tool definition budget based on complexity.
   */
  private resolveToolDefinitionBudget(complexity: TaskComplexity): number {
    switch (complexity) {
      case 'simple':
        return Math.min(6000, this.maxToolDefinitionTokens);
      case 'moderate':
        return Math.min(9000, this.maxToolDefinitionTokens);
      case 'complex':
        return this.maxToolDefinitionTokens;
    }
  }

  /**
   * Resolve response budget based on complexity.
   */
  private resolveResponseBudget(complexity: TaskComplexity): number {
    switch (complexity) {
      case 'simple':
        return Math.max(2000, this.minResponseReserve);
      case 'moderate':
        return Math.max(4000, this.minResponseReserve);
      case 'complex':
        return Math.max(8000, this.minResponseReserve * 2);
    }
  }

  /**
   * Check if a given token usage fits within budget.
   */
  fitsInBudget(
    usage: {
      systemPrompt?: number;
      toolDefinitions?: number;
      conversationHistory?: number;
    },
    complexity: TaskComplexity = 'moderate',
  ): boolean {
    const budget = this.allocate(complexity);

    const systemPromptOk = (usage.systemPrompt ?? 0) <= budget.systemPrompt;
    const toolDefinitionsOk = (usage.toolDefinitions ?? 0) <= budget.toolDefinitions;
    const conversationHistoryOk = (usage.conversationHistory ?? 0) <= budget.conversationHistory;

    return systemPromptOk && toolDefinitionsOk && conversationHistoryOk;
  }

  /**
   * Get the maximum tokens available for conversation history
   * given current system prompt and tool definition usage.
   */
  getAvailableHistoryTokens(
    systemPromptTokens: number,
    toolDefinitionTokens: number,
    complexity: TaskComplexity = 'moderate',
  ): number {
    const budget = this.allocate(complexity);
    return Math.max(
      0,
      this.maxContextTokens -
        systemPromptTokens -
        toolDefinitionTokens -
        budget.reservedForResponse,
    );
  }

  /**
   * Compute context usage ratio.
   */
  computeUsageRatio(
    usedTokens: number,
    complexity: TaskComplexity = 'moderate',
  ): number {
    const budget = this.allocate(complexity);
    const usableTokens = budget.total - budget.reservedForResponse;
    return Math.min(1, usedTokens / usableTokens);
  }
}

/**
 * Infer task complexity from context clues.
 */
export function inferTaskComplexity(clues: {
  messageCount?: number;
  toolCallCount?: number;
  hasCodeGeneration?: boolean;
  hasMultiFileEdits?: boolean;
}): TaskComplexity {
  const { messageCount = 0, toolCallCount = 0, hasCodeGeneration = false, hasMultiFileEdits = false } = clues;

  // Complex: multi-file edits or many tool calls
  if (hasMultiFileEdits || toolCallCount > 20) {
    return 'complex';
  }

  // Moderate: code generation or moderate conversation
  if (hasCodeGeneration || messageCount > 10 || toolCallCount > 5) {
    return 'moderate';
  }

  // Simple: short conversation
  return 'simple';
}

/**
 * Create a token budget manager with default configuration.
 */
export function createTokenBudgetManager(
  maxContextTokens: number,
  config?: Partial<TokenBudgetConfig>,
): TokenBudgetManager {
  return new TokenBudgetManager({
    maxContextTokens,
    ...config,
  });
}
