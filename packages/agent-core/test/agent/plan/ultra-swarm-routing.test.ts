import { describe, expect, it } from 'vitest';

import {
  intensityToDefaultExpertCount,
  routeFromPlanSignals,
  type SwarmRoutingIntensity,
} from '#/agent/plan/ultra-swarm-routing';

describe('agent/plan/ultra-swarm-routing — routeFromPlanSignals', () => {
  describe('intensityToDefaultExpertCount', () => {
    it('returns 4 / 12 / 24 experts for light / standard / heavy', () => {
      const cases: Array<[SwarmRoutingIntensity, number]> = [
        ['light', 4],
        ['standard', 12],
        ['heavy', 24],
      ];
      for (const [intensity, expected] of cases) {
        expect(intensityToDefaultExpertCount(intensity)).toBe(expected);
      }
    });
  });

  describe('routeFromPlanSignals', () => {
    it('returns undefined when the plan has no swarm decision signal', () => {
      expect(routeFromPlanSignals('Just a regular implementation plan.')).toBeUndefined();
    });

    it('routes ENGAGE plans to a heavy swarm with the ENGAGE rationale', () => {
      const result = routeFromPlanSignals('Some preface\nSwarm decision: ENGAGE\nMore text');
      expect(result).toBeDefined();
      expect(result?.decision).toBe('ENGAGE');
      expect(result?.intensity).toBe('heavy');
      expect(result?.estimatedExperts).toBe(24);
      expect(result?.rationale).toMatch(/specialist swarm/);
    });

    it('routes ADAPTIVE plans to a standard swarm', () => {
      const result = routeFromPlanSignals('Swarm decision: ADAPTIVE — partial complexity');
      expect(result?.decision).toBe('ADAPTIVE');
      expect(result?.intensity).toBe('standard');
      expect(result?.estimatedExperts).toBe(12);
    });

    it('upgrades a DEFER plan to ADAPTIVE when --swarm override is present', () => {
      const result = routeFromPlanSignals('Swarm decision: DEFER\nbut please use --swarm to force it');
      expect(result?.decision).toBe('ADAPTIVE');
      expect(result?.intensity).toBe('standard');
      expect(result?.estimatedExperts).toBe(12);
    });

    it('upgrades a DEFER plan to ADAPTIVE on "force swarm: yes"', () => {
      const result = routeFromPlanSignals('Swarm decision: DEFER\nForce Swarm: yes');
      expect(result?.decision).toBe('ADAPTIVE');
    });

    it('leaves a DEFER plan alone when no override is present', () => {
      const result = routeFromPlanSignals('Swarm decision: DEFER — single agent suffices.');
      expect(result?.decision).toBe('DEFER');
      expect(result?.intensity).toBe('light');
      expect(result?.estimatedExperts).toBe(0);
    });

    it('honors an explicit "swarm intensity: light" override', () => {
      const result = routeFromPlanSignals('Swarm decision: ENGAGE\nswarm intensity: light please');
      expect(result?.decision).toBe('ENGAGE');
      expect(result?.intensity).toBe('light');
      expect(result?.estimatedExperts).toBe(4);
    });

    it('honors a case-insensitive explicit intensity', () => {
      const result = routeFromPlanSignals('Swarm decision: ADAPTIVE\nSwarm Intensity: HEAVY please');
      expect(result?.intensity).toBe('heavy');
      expect(result?.estimatedExperts).toBe(24);
    });

    it('recognizes the bullet-list "Decision: ENGAGE" form', () => {
      const result = routeFromPlanSignals('- Decision: ENGAGE');
      expect(result?.decision).toBe('ENGAGE');
      expect(result?.intensity).toBe('heavy');
    });
  });
});
