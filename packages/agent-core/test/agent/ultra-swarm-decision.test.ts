import { describe, expect, it } from 'vitest';
import { ultraSwarmDecision, ultraSwarmEngageNextAction } from '../../src/agent/plan/ultra-swarm-decision';

describe('ultraSwarmDecision', () => {
  describe('ternary decision parsing', () => {
    it('parses ENGAGE from "Swarm decision: ENGAGE"', () => {
      expect(ultraSwarmDecision('Swarm decision: ENGAGE - multi-lane work')).toBe('ENGAGE');
    });

    it('parses DEFER from "Swarm decision: DEFER"', () => {
      expect(ultraSwarmDecision('Swarm decision: DEFER - single-owner task')).toBe('DEFER');
    });

    it('parses ADAPTIVE from "Swarm decision: ADAPTIVE"', () => {
      expect(ultraSwarmDecision('Swarm decision: ADAPTIVE - moderate complexity')).toBe('ADAPTIVE');
    });

    it('parses ADAPTIVE from a "- Decision: ADAPTIVE" field line', () => {
      expect(ultraSwarmDecision('- Decision: ADAPTIVE')).toBe('ADAPTIVE');
    });

    it('returns undefined when no decision line is present', () => {
      expect(ultraSwarmDecision('some plan without a swarm decision')).toBeUndefined();
    });

    it('is case-insensitive for ADAPTIVE', () => {
      expect(ultraSwarmDecision('Swarm decision: adaptive')).toBe('ADAPTIVE');
    });
  });

  describe('ultraSwarmEngageNextAction', () => {
    it('returns undefined for DEFER', () => {
      expect(ultraSwarmEngageNextAction('Swarm decision: DEFER')).toBeUndefined();
    });

    it('returns undefined for ADAPTIVE (next-action guidance is ENGAGE-only)', () => {
      expect(ultraSwarmEngageNextAction('Swarm decision: ADAPTIVE')).toBeUndefined();
    });

    it('returns guidance string for ENGAGE', () => {
      expect(ultraSwarmEngageNextAction('Swarm decision: ENGAGE')).toContain('UltraSwarm ENGAGE is binding');
    });
  });
});
