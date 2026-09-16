/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  resolveGuidedComparisonLoad,
  calculateRequiredCapacityIndex,
  calculateRelativeChallenge,
  isWithinResistanceChangeCap,
  resolveGuidedBodyweightKg,
  normalizeGuidedUnit,
  GUIDED_RESISTANCE_CHANGE_CAP,
  getRpePercentage,
  isValidRPE,
} from '../adaptiveProgressionMath';
import { convertWeightUnit, LB_TO_KG } from '../assistedLoadMath';

describe('Adaptive Progression Guided Comparison-Load Foundation (APC-3B2A)', () => {
  describe('1. Weighted Modality Resolution', () => {
    it('resolves 100 kg to exactly 100 kg comparison load with external_weight_v1 basis', () => {
      const result = resolveGuidedComparisonLoad('weighted', 100, null, 'kg');
      expect(result).toEqual({
        eligible: true,
        loadBasis: 'external_weight_v1',
        comparisonLoadKg: 100,
      });
    });

    it('resolves equivalent lb input to canonical kg load with floating-point precision', () => {
      const result = resolveGuidedComparisonLoad('weighted', 220.46226218, null, 'lb');
      expect(result.eligible).toBe(true);
      if (result.eligible) {
        expect(result.loadBasis).toBe('external_weight_v1');
        expect(result.comparisonLoadKg).toBeCloseTo(100, 6);
        expect(result.comparisonLoadKg).toBe(220.46226218 * LB_TO_KG);
      }
    });

    it('handles legacy "lbs" unit string equivalently to "lb"', () => {
      const result = resolveGuidedComparisonLoad('weighted', 200, null, 'lbs');
      expect(result.eligible).toBe(true);
      if (result.eligible) {
        expect(result.comparisonLoadKg).toBe(200 * LB_TO_KG);
      }
    });

    it('confirms bodyweight changes do not affect weighted comparison load', () => {
      const loadWithoutBw = resolveGuidedComparisonLoad('weighted', 100, null, 'kg');
      const loadWithBw80 = resolveGuidedComparisonLoad('weighted', 100, 80, 'kg');
      const loadWithBw120 = resolveGuidedComparisonLoad('weighted', 100, { value: 120, unit: 'kg' }, 'kg');

      expect(loadWithoutBw).toEqual(loadWithBw80);
      expect(loadWithoutBw).toEqual(loadWithBw120);
    });

    it('fails closed with INVALID_WEIGHT for zero, negative, NaN, and infinite loads', () => {
      expect(resolveGuidedComparisonLoad('weighted', 0, null, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_WEIGHT',
      });
      expect(resolveGuidedComparisonLoad('weighted', -50, null, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_WEIGHT',
      });
      expect(resolveGuidedComparisonLoad('weighted', NaN, null, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_WEIGHT',
      });
      expect(resolveGuidedComparisonLoad('weighted', Infinity, null, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_WEIGHT',
      });
      expect(resolveGuidedComparisonLoad('weighted', null, null, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_WEIGHT',
      });
      expect(resolveGuidedComparisonLoad('weighted', undefined, null, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_WEIGHT',
      });
    });

    it('does not round comparison load to plate increments (preserves arbitrary decimals)', () => {
      const result = resolveGuidedComparisonLoad('weighted', 83.333333, null, 'kg');
      expect(result.eligible).toBe(true);
      if (result.eligible) {
        expect(result.comparisonLoadKg).toBe(83.333333);
      }
    });
  });

  describe('2. Pure Bodyweight Modality Resolution', () => {
    it('resolves 80 kg bodyweight to 80 kg comparison load with bodyweight_normalized_v1 basis', () => {
      const result = resolveGuidedComparisonLoad('bodyweight', 0, 80, 'kg');
      expect(result).toEqual({
        eligible: true,
        loadBasis: 'bodyweight_normalized_v1',
        comparisonLoadKg: 80,
      });
    });

    it('resolves bodyweight snapshot object correctly', () => {
      const result = resolveGuidedComparisonLoad('bodyweight', 0, { value: 80, unit: 'kg' }, 'kg');
      expect(result).toEqual({
        eligible: true,
        loadBasis: 'bodyweight_normalized_v1',
        comparisonLoadKg: 80,
      });
    });

    it('resolves equivalent bodyweight in lb to canonical kg load', () => {
      const lbWeight = 176.36980974; // ~80 kg
      const result = resolveGuidedComparisonLoad('bodyweight', 0, lbWeight, 'lb');
      expect(result.eligible).toBe(true);
      if (result.eligible) {
        expect(result.loadBasis).toBe('bodyweight_normalized_v1');
        expect(result.comparisonLoadKg).toBeCloseTo(80, 5);
      }

      const snapResult = resolveGuidedComparisonLoad('bodyweight', 0, { value: lbWeight, unit: 'lb' }, 'kg');
      expect(snapResult.eligible).toBe(true);
      if (snapResult.eligible) {
        expect(snapResult.comparisonLoadKg).toBeCloseTo(80, 5);
      }
    });

    it('fails safely with INVALID_EXTERNAL_WEIGHT if displayed weight is non-zero', () => {
      expect(resolveGuidedComparisonLoad('bodyweight', 5, 80, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_EXTERNAL_WEIGHT',
      });
      expect(resolveGuidedComparisonLoad('bodyweight', -5, 80, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_EXTERNAL_WEIGHT',
      });
    });

    it('accepts null, undefined, or explicit 0 for bodyweight external weight', () => {
      expect(resolveGuidedComparisonLoad('bodyweight', 0, 80, 'kg').eligible).toBe(true);
      expect(resolveGuidedComparisonLoad('bodyweight', null, 80, 'kg').eligible).toBe(true);
      expect(resolveGuidedComparisonLoad('bodyweight', undefined, 80, 'kg').eligible).toBe(true);
    });

    it('fails closed with MISSING_BODYWEIGHT for missing, zero, negative, NaN, or infinite bodyweight without 75 kg fallback', () => {
      expect(resolveGuidedComparisonLoad('bodyweight', 0, null, 'kg')).toEqual({
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      });
      expect(resolveGuidedComparisonLoad('bodyweight', 0, undefined, 'kg')).toEqual({
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      });
      expect(resolveGuidedComparisonLoad('bodyweight', 0, 0, 'kg')).toEqual({
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      });
      expect(resolveGuidedComparisonLoad('bodyweight', 0, -80, 'kg')).toEqual({
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      });
      expect(resolveGuidedComparisonLoad('bodyweight', 0, NaN, 'kg')).toEqual({
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      });
      expect(resolveGuidedComparisonLoad('bodyweight', 0, Infinity, 'kg')).toEqual({
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      });
      expect(resolveGuidedComparisonLoad('bodyweight', 0, { value: null, unit: 'kg' }, 'kg')).toEqual({
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      });
    });
  });

  describe('3. Assisted Modality Resolution', () => {
    it('resolves 80 kg bodyweight with 20 kg assistance to 60 kg comparison load', () => {
      const result = resolveGuidedComparisonLoad('assisted', 20, 80, 'kg');
      expect(result).toEqual({
        eligible: true,
        loadBasis: 'assisted_net_normalized_v1',
        comparisonLoadKg: 60,
      });
    });

    it('resolves 80 kg bodyweight with 17.5 kg assistance to 62.5 kg comparison load', () => {
      const result = resolveGuidedComparisonLoad('assisted', 17.5, 80, 'kg');
      expect(result).toEqual({
        eligible: true,
        loadBasis: 'assisted_net_normalized_v1',
        comparisonLoadKg: 62.5,
      });
    });

    it('resolves 80 kg bodyweight with 50 kg assistance to 30 kg comparison load', () => {
      const result = resolveGuidedComparisonLoad('assisted', 50, 80, 'kg');
      expect(result).toEqual({
        eligible: true,
        loadBasis: 'assisted_net_normalized_v1',
        comparisonLoadKg: 30,
      });
    });

    it('lower assistance correctly produces higher comparison load', () => {
      const resHighAssistance = resolveGuidedComparisonLoad('assisted', 20, 80, 'kg');
      const resLowAssistance = resolveGuidedComparisonLoad('assisted', 17.5, 80, 'kg');

      expect(resHighAssistance.eligible).toBe(true);
      expect(resLowAssistance.eligible).toBe(true);
      if (resHighAssistance.eligible && resLowAssistance.eligible) {
        expect(resLowAssistance.comparisonLoadKg).toBeGreaterThan(resHighAssistance.comparisonLoadKg);
      }
    });

    it('resolves equivalent lb values producing equivalent canonical kg load', () => {
      const bwLb = 176.36980974; // 80 kg
      const assistLb = 44.092452436; // 20 kg
      const result = resolveGuidedComparisonLoad('assisted', assistLb, bwLb, 'lb');
      expect(result.eligible).toBe(true);
      if (result.eligible) {
        expect(result.loadBasis).toBe('assisted_net_normalized_v1');
        expect(result.comparisonLoadKg).toBeCloseTo(60, 4);
      }
    });

    it('fails closed with INVALID_ASSISTANCE for zero, negative, NaN, infinite, or excessive assistance', () => {
      // Zero assistance is invalid (does not convert to bodyweight)
      expect(resolveGuidedComparisonLoad('assisted', 0, 80, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_ASSISTANCE',
      });
      // Negative assistance
      expect(resolveGuidedComparisonLoad('assisted', -10, 80, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_ASSISTANCE',
      });
      // NaN or infinite
      expect(resolveGuidedComparisonLoad('assisted', NaN, 80, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_ASSISTANCE',
      });
      expect(resolveGuidedComparisonLoad('assisted', Infinity, 80, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_ASSISTANCE',
      });
      // Assistance equal to bodyweight
      expect(resolveGuidedComparisonLoad('assisted', 80, 80, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_ASSISTANCE',
      });
      // Assistance exceeding bodyweight
      expect(resolveGuidedComparisonLoad('assisted', 85, 80, 'kg')).toEqual({
        eligible: false,
        reason: 'INVALID_ASSISTANCE',
      });
    });

    it('fails with MISSING_BODYWEIGHT if bodyweight is missing on assisted exercise', () => {
      expect(resolveGuidedComparisonLoad('assisted', 20, null, 'kg')).toEqual({
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      });
    });
  });

  describe('4. Unsupported Modalities Excluded from Guided v1', () => {
    it('rejects timed, distance, and distance_loaded with UNSUPPORTED_MODALITY', () => {
      expect(resolveGuidedComparisonLoad('timed', 60, null, 'kg')).toEqual({
        eligible: false,
        reason: 'UNSUPPORTED_MODALITY',
      });
      expect(resolveGuidedComparisonLoad('distance', 1000, null, 'kg')).toEqual({
        eligible: false,
        reason: 'UNSUPPORTED_MODALITY',
      });
      expect(resolveGuidedComparisonLoad('distance_loaded', 50, null, 'kg')).toEqual({
        eligible: false,
        reason: 'UNSUPPORTED_MODALITY',
      });
      expect(resolveGuidedComparisonLoad('custom_cardio', 100, null, 'kg')).toEqual({
        eligible: false,
        reason: 'UNSUPPORTED_MODALITY',
      });
    });
  });

  describe('5. Required-Capacity Index Authority', () => {
    it('verifies canonical production RPE multipliers directly via getRpePercentage', () => {
      expect(getRpePercentage(8.0, 8)).toBe(0.728);
      expect(getRpePercentage(8.0, 9)).toBe(0.702);
      expect(getRpePercentage(8.0, 10)).toBe(0.680);
      expect(getRpePercentage(8.0, 11)).toBe(0.644);
      expect(getRpePercentage(8.0, 12)).toBe(0.618);
      expect(getRpePercentage(7.0, 5)).toBe(0.779);
      expect(getRpePercentage(8.0, 3)).toBe(0.863);
    });

    it('calculates required capacity index for 80 kg, 8 reps @ RPE 8.0 using positional and object signatures', () => {
      const expectedCapacity = 80 / 0.728; // 109.8901098901099
      const capacityPositional = calculateRequiredCapacityIndex(80, 8, 8.0);
      const capacityObject = calculateRequiredCapacityIndex({
        comparisonLoadKg: 80,
        reps: 8,
        rpe: 8.0,
      });

      expect(capacityPositional).not.toBeNull();
      expect(capacityPositional!).toBeCloseTo(expectedCapacity, 4);
      expect(capacityPositional!).toBeCloseTo(109.8901098901099, 4);

      expect(capacityObject).not.toBeNull();
      expect(capacityObject!).toBeCloseTo(expectedCapacity, 4);
      expect(capacityObject!).toBeCloseTo(109.8901098901099, 4);
    });

    it('supports object argument structure for calculateRequiredCapacityIndex with 100 kg, 5 reps @ RPE 8.0', () => {
      const res = calculateRequiredCapacityIndex({
        comparisonLoadKg: 100,
        reps: 5,
        rpe: 8.0,
      });
      // 5 reps @ RPE 8.0 -> 0.807
      expect(res).not.toBeNull();
      expect(res!).toBeCloseTo(100 / 0.807, 4);
    });

    it('fails safely and returns null for non-positive or non-finite comparison loads', () => {
      expect(calculateRequiredCapacityIndex(0, 5, 8.0)).toBeNull();
      expect(calculateRequiredCapacityIndex(-50, 5, 8.0)).toBeNull();
      expect(calculateRequiredCapacityIndex(NaN, 5, 8.0)).toBeNull();
      expect(calculateRequiredCapacityIndex(Infinity, 5, 8.0)).toBeNull();
    });

    it('fails safely and returns null for invalid repetition counts', () => {
      expect(calculateRequiredCapacityIndex(100, 0, 8.0)).toBeNull();
      expect(calculateRequiredCapacityIndex(100, -1, 8.0)).toBeNull();
      expect(calculateRequiredCapacityIndex(100, 3.5, 8.0)).toBeNull();
      expect(calculateRequiredCapacityIndex(100, NaN, 8.0)).toBeNull();
    });

    it('fails safely and returns null for invalid RPE values violating exact canonical half-step', () => {
      expect(calculateRequiredCapacityIndex(100, 5, 5.5)).toBeNull();
      expect(calculateRequiredCapacityIndex(100, 5, 10.5)).toBeNull();
      expect(calculateRequiredCapacityIndex(100, 5, 8.2)).toBeNull();
      expect(calculateRequiredCapacityIndex(100, 5, 7.999)).toBeNull();
      expect(calculateRequiredCapacityIndex(100, 5, NaN)).toBeNull();
    });
  });

  describe('6. Relative Challenge and 5.0% Resistance-Change Cap', () => {
    it('calculates relative challenge correctly with positive, zero, and negative deltas', () => {
      expect(calculateRelativeChallenge(105, 100)).toBeCloseTo(0.05, 6);
      expect(calculateRelativeChallenge(100, 100)).toBe(0);
      expect(calculateRelativeChallenge(95, 100)).toBeCloseTo(-0.05, 6);
    });

    it('preserves negative challenge values without clamping', () => {
      const negChallenge = calculateRelativeChallenge(90, 100);
      expect(negChallenge).toBe(-0.10);
      expect(isWithinResistanceChangeCap(negChallenge)).toBe(true);
    });

    it('strictly enforces exactly 5.0% cap boundary (0.05 passes, > 0.05 fails)', () => {
      expect(GUIDED_RESISTANCE_CHANGE_CAP).toBe(0.05);

      expect(isWithinResistanceChangeCap(0.0499)).toBe(true);
      expect(isWithinResistanceChangeCap(0.05)).toBe(true);
      expect(isWithinResistanceChangeCap(0.050000001)).toBe(false);
      expect(isWithinResistanceChangeCap(0.06)).toBe(false);
      expect(isWithinResistanceChangeCap(null)).toBe(false);
      expect(isWithinResistanceChangeCap(undefined)).toBe(false);
      expect(isWithinResistanceChangeCap(NaN)).toBe(false);
    });

    it('returns null for invalid baseline or candidate capacities', () => {
      expect(calculateRelativeChallenge(100, 0)).toBeNull();
      expect(calculateRelativeChallenge(100, -10)).toBeNull();
      expect(calculateRelativeChallenge(0, 100)).toBeNull();
      expect(calculateRelativeChallenge(-10, 100)).toBeNull();
      expect(calculateRelativeChallenge(NaN, 100)).toBeNull();
      expect(calculateRelativeChallenge(100, NaN)).toBeNull();
    });
  });

  describe('7. Required Numerical Benchmark Scenarios', () => {
    it('Bodyweight candidate: unchanged 80 kg, 9 reps @ RPE 8.0 vs 80 kg, 8 reps @ RPE 8.0 produces +3.7037% and passes cap', () => {
      const baselineCap = calculateRequiredCapacityIndex(80, 8, 8.0)!;
      const candidateCap = calculateRequiredCapacityIndex(80, 9, 8.0)!;
      const challenge = calculateRelativeChallenge(candidateCap, baselineCap)!;

      // Canonical math: 0.728 / 0.702 - 1 = 0.037037037... ≈ +3.7037%
      expect(challenge).toBeCloseTo(0.037037, 4);
      expect(isWithinResistanceChangeCap(challenge)).toBe(true);
    });

    it('Bodyweight candidate: increased 82 kg, 9 reps @ RPE 8.0 vs 80 kg, 8 reps @ RPE 8.0 produces +6.2963% and fails cap', () => {
      // Baseline: 80 kg, 8 reps @ RPE 8.0 (canonical multiplier 0.728)
      // Candidate: 82 kg, 9 reps @ RPE 8.0 (canonical multiplier 0.702)
      const baselineCap = calculateRequiredCapacityIndex(80, 8, 8.0)!;
      const candidateCap = calculateRequiredCapacityIndex(82, 9, 8.0)!;
      const challenge = calculateRelativeChallenge(candidateCap, baselineCap)!;

      // Canonical math: (82 / 0.702 - 80 / 0.728) / (80 / 0.728) = 0.062962962... ≈ +6.2963%
      expect(challenge).toBeCloseTo(0.062963, 4);
      expect(isWithinResistanceChangeCap(challenge)).toBe(false);
    });

    it('Bodyweight candidate: decreased 78 kg, 9 reps @ RPE 8.0 vs 80 kg, 8 reps @ RPE 8.0 produces +1.1111% and passes cap', () => {
      // Baseline: 80 kg, 8 reps @ RPE 8.0
      // Candidate: 78 kg, 9 reps @ RPE 8.0
      const baselineCap = calculateRequiredCapacityIndex(80, 8, 8.0)!;
      const candidateCap = calculateRequiredCapacityIndex(78, 9, 8.0)!;
      const challenge = calculateRelativeChallenge(candidateCap, baselineCap)!;

      // Canonical math: (78 / 0.702 - 80 / 0.728) / (80 / 0.728) = 0.011111111... ≈ +1.1111%
      expect(challenge).toBeCloseTo(0.011111, 4);
      expect(isWithinResistanceChangeCap(challenge)).toBe(true);
    });

    it('Assisted candidate: 80 kg BW, 20->17.5 kg assistance at 5 reps / RPE 7.0 produces +4.17% and passes', () => {
      const loadBaseline = resolveGuidedComparisonLoad('assisted', 20, 80, 'kg');
      const loadCandidate = resolveGuidedComparisonLoad('assisted', 17.5, 80, 'kg');

      expect(loadBaseline.eligible).toBe(true);
      expect(loadCandidate.eligible).toBe(true);

      if (loadBaseline.eligible && loadCandidate.eligible) {
        const baseCap = calculateRequiredCapacityIndex(loadBaseline.comparisonLoadKg, 5, 7.0)!;
        const candCap = calculateRequiredCapacityIndex(loadCandidate.comparisonLoadKg, 5, 7.0)!;
        const challenge = calculateRelativeChallenge(candCap, baseCap)!;

        // Exactly (62.5 - 60) / 60 = 2.5 / 60 = +4.16666...% ≈ +4.17%
        expect(challenge).toBeCloseTo(0.0416667, 4);
        expect(isWithinResistanceChangeCap(challenge)).toBe(true);
      }
    });

    it('Assisted candidate: 80 kg BW, 50->47.5 kg assistance produces +8.33% and fails cap', () => {
      const loadBaseline = resolveGuidedComparisonLoad('assisted', 50, 80, 'kg');
      const loadCandidate = resolveGuidedComparisonLoad('assisted', 47.5, 80, 'kg');

      expect(loadBaseline.eligible).toBe(true);
      expect(loadCandidate.eligible).toBe(true);

      if (loadBaseline.eligible && loadCandidate.eligible) {
        const baseCap = calculateRequiredCapacityIndex(loadBaseline.comparisonLoadKg, 5, 7.0)!;
        const candCap = calculateRequiredCapacityIndex(loadCandidate.comparisonLoadKg, 5, 7.0)!;
        const challenge = calculateRelativeChallenge(candCap, baseCap)!;

        // Exactly (32.5 - 30) / 30 = 2.5 / 30 = +8.3333...% ≈ +8.33%
        expect(challenge).toBeCloseTo(0.0833333, 4);
        expect(isWithinResistanceChangeCap(challenge)).toBe(false);
      }
    });

    it('Raw rep-transition at unchanged load and RPE 8.0: 8->9 reps produces +3.7037% and passes cap', () => {
      const baseCap = calculateRequiredCapacityIndex(100, 8, 8.0)!;
      const candCap = calculateRequiredCapacityIndex(100, 9, 8.0)!;
      const challenge = calculateRelativeChallenge(candCap, baseCap)!;

      // Canonical math: 0.728 / 0.702 - 1 = 0.037037037...
      expect(challenge).toBeCloseTo(0.037037, 4);
      expect(isWithinResistanceChangeCap(challenge)).toBe(true);
    });

    it('Raw rep-transition at unchanged load and RPE 8.0: 9->10 reps produces +3.2353% and passes cap', () => {
      const baseCap = calculateRequiredCapacityIndex(100, 9, 8.0)!;
      const candCap = calculateRequiredCapacityIndex(100, 10, 8.0)!;
      const challenge = calculateRelativeChallenge(candCap, baseCap)!;

      // Canonical math: 0.702 / 0.680 - 1 = 0.032352941...
      expect(challenge).toBeCloseTo(0.032353, 4);
      expect(isWithinResistanceChangeCap(challenge)).toBe(true);
    });

    it('Raw rep-transition at unchanged load and RPE 8.0: 10->11 reps produces +5.5901% and fails 5.0% cap', () => {
      const baseCap = calculateRequiredCapacityIndex(100, 10, 8.0)!;
      const candCap = calculateRequiredCapacityIndex(100, 11, 8.0)!;
      const challenge = calculateRelativeChallenge(candCap, baseCap)!;

      // Canonical math: 0.680 / 0.644 - 1 = 0.055900621...
      expect(challenge).toBeCloseTo(0.055901, 4);
      expect(isWithinResistanceChangeCap(challenge)).toBe(false);
      // Confirmed under 6.5% bound reserved for future policy consideration:
      expect(challenge).toBeLessThanOrEqual(0.065);
    });

    it('Raw rep-transition at unchanged load and RPE 8.0: 11->12 reps produces +4.2071% and passes cap', () => {
      const baseCap = calculateRequiredCapacityIndex(100, 11, 8.0)!;
      const candCap = calculateRequiredCapacityIndex(100, 12, 8.0)!;
      const challenge = calculateRelativeChallenge(candCap, baseCap)!;

      // Canonical math: 0.644 / 0.618 - 1 = 0.042071197...
      expect(challenge).toBeCloseTo(0.042071, 4);
      expect(isWithinResistanceChangeCap(challenge)).toBe(true);
    });

    it('Exactly +5.0% passes the resistance change cap', () => {
      const baseCap = 100;
      const candCap = 105;
      const challenge = calculateRelativeChallenge(candCap, baseCap)!;
      expect(challenge).toBe(0.05);
      expect(isWithinResistanceChangeCap(challenge)).toBe(true);
    });
  });

  describe('8. Complete Matrix Boundary Protection (99 Transitions)', () => {
    it('evaluates all 99 adjacent transitions across RPE 6.0-10.0 and reps 1-12 against 5.0% and 6.5% caps', () => {
      const canonicalRPEs = [6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0];
      const failingTransitions: Array<{ rpe: number; curReps: number; candReps: number; challenge: number }> = [];
      const allChallenges: number[] = [];
      let maxChallenge = -Infinity;
      let maxTransition: { rpe: number; curReps: number; candReps: number; challenge: number } | null = null;

      for (const rpe of canonicalRPEs) {
        for (let reps = 1; reps <= 11; reps++) {
          const curReps = reps;
          const candReps = reps + 1;

          // Direct production lookup
          const curMult = getRpePercentage(rpe, curReps);
          const candMult = getRpePercentage(rpe, candReps);
          expect(curMult).not.toBeNull();
          expect(candMult).not.toBeNull();

          // Production capacity index & challenge
          const baseCap = calculateRequiredCapacityIndex(100, curReps, rpe);
          const candCap = calculateRequiredCapacityIndex(100, candReps, rpe);
          expect(baseCap).not.toBeNull();
          expect(candCap).not.toBeNull();

          const challenge = calculateRelativeChallenge(candCap!, baseCap!);
          expect(challenge).not.toBeNull();
          allChallenges.push(challenge!);

          const withinCap = isWithinResistanceChangeCap(challenge!);
          if (!withinCap) {
            failingTransitions.push({ rpe, curReps, candReps, challenge: challenge! });
          }

          if (challenge! > maxChallenge) {
            maxChallenge = challenge!;
            maxTransition = { rpe, curReps, candReps, challenge: challenge! };
          }
        }
      }

      // 9 RPEs * 11 adjacent transitions = 99 transitions
      expect(allChallenges).toHaveLength(99);

      // Exactly 5 transitions exceed the current 5.0% resistance change cap
      expect(failingTransitions).toHaveLength(5);

      // All five failing transitions are 10->11 transitions
      expect(failingTransitions.every(t => t.curReps === 10 && t.candReps === 11)).toBe(true);

      // Failing RPE values are exactly 6.0, 6.5, 7.0, 7.5, 8.0
      expect(failingTransitions.map(t => t.rpe)).toEqual([6.0, 6.5, 7.0, 7.5, 8.0]);

      // Maximum adjacent-rep challenge is approximately 0.0603015075 at 10->11 reps @ RPE 6.5
      expect(maxTransition).not.toBeNull();
      expect(maxTransition!.rpe).toBe(6.5);
      expect(maxTransition!.curReps).toBe(10);
      expect(maxTransition!.candReps).toBe(11);
      expect(maxChallenge).toBeCloseTo(0.0603015075, 6);

      // No adjacent transition exceeds 6.5%
      expect(allChallenges.every(c => c <= 0.065)).toBe(true);
    });
  });

  describe('9. Zero Production Call Sites and Non-Regression Safety', () => {
    it('verifies exact isValidRPE authority behavior is preserved', () => {
      expect(isValidRPE(6.0)).toBe(true);
      expect(isValidRPE(8.0)).toBe(true);
      expect(isValidRPE(10.0)).toBe(true);
      expect(isValidRPE(7.5)).toBe(true);

      expect(isValidRPE(5.5)).toBe(false);
      expect(isValidRPE(10.5)).toBe(false);
      expect(isValidRPE(8.2)).toBe(false);
      expect(isValidRPE(null)).toBe(false);
    });
  });
});
