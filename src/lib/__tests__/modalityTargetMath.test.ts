/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  projectAssistedTarget,
  solveBodyweightRepTarget,
  ProjectAssistedTargetParams,
  SolveBodyweightRepParams,
} from '../modalityTargetMath';
import { convertWeightUnit } from '../assistedLoadMath';
import { getRTSMultiplier } from '../rpeMath';

describe('modalityTargetMath', () => {
  describe('projectAssistedTarget', () => {
    it('produces 57.5 kg assistance, 42.5 kg achieved load, and quantized status for 100 kg BW and 43.26 kg target load', () => {
      const params: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 43.26,
        sessionBodyweight: 100.0,
        targetReps: 12,
        targetRPE: 8.0,
        unit: 'kg',
      };
      const result = projectAssistedTarget(params);
      expect(result.status).toBe('quantized');
      expect(result.assistanceWeight).toBe(57.5);
      expect(result.achievedEffectiveLoad).toBe(42.5);
      expect(result.reps).toBe(12);
      expect(result.rpe).toBe(8.0);
      expect(result.unit).toBe('kg');
      expect(result.targetEffectiveLoad).toBe(43.26);
    });

    it('returns exact status for exactly representable assistance', () => {
      const params: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: 100.0,
        targetReps: 8,
        targetRPE: 8.0,
        unit: 'kg',
      };
      const result = projectAssistedTarget(params);
      expect(result.status).toBe('exact');
      expect(result.assistanceWeight).toBe(50.0);
      expect(result.achievedEffectiveLoad).toBe(50.0);
      expect(result.reps).toBe(8);
      expect(result.rpe).toBe(8.0);
    });

    it('handles zero-assistance boundary with exact status', () => {
      const params: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 80.0,
        sessionBodyweight: 80.0,
        targetReps: 5,
        targetRPE: 8.5,
        unit: 'kg',
      };
      const result = projectAssistedTarget(params);
      expect(result.status).toBe('exact');
      expect(result.assistanceWeight).toBe(0.0);
      expect(result.achievedEffectiveLoad).toBe(80.0);
    });

    it('handles negative-assistance boundary by clamping to 0 with constrained status', () => {
      const params: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 90.0,
        sessionBodyweight: 80.0,
        targetReps: 5,
        targetRPE: 8.5,
        unit: 'kg',
      };
      const result = projectAssistedTarget(params);
      expect(result.status).toBe('constrained');
      expect(result.constraintReason).toBe('assisted_negative_assistance');
      expect(result.assistanceWeight).toBe(0.0);
      expect(result.achievedEffectiveLoad).toBe(80.0);
    });

    it('handles zero or negative target effective load with constrained status', () => {
      const zeroLoad: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 0.0,
        sessionBodyweight: 80.0,
        targetReps: 10,
        targetRPE: 8.0,
        unit: 'kg',
      };
      const resultZero = projectAssistedTarget(zeroLoad);
      expect(resultZero.status).toBe('constrained');
      expect(resultZero.constraintReason).toBe('assisted_zero_or_negative_load');
      expect(resultZero.assistanceWeight).toBe(77.5);
      expect(resultZero.achievedEffectiveLoad).toBe(2.5);

      const negativeLoad: ProjectAssistedTargetParams = {
        targetEffectiveLoad: -10.0,
        sessionBodyweight: 80.0,
        targetReps: 10,
        targetRPE: 8.0,
        unit: 'kg',
      };
      const resultNeg = projectAssistedTarget(negativeLoad);
      expect(resultNeg.status).toBe('constrained');
      expect(resultNeg.constraintReason).toBe('assisted_zero_or_negative_load');
      expect(resultNeg.assistanceWeight).toBe(77.5);
    });

    it('handles near-bodyweight target where rounding would equal bodyweight by clamping to grid limit', () => {
      const params: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 1.0, // 80 - 1 = 79 kg unrounded assistance -> roundTo2.5 = 80 kg
        sessionBodyweight: 80.0,
        targetReps: 10,
        targetRPE: 8.0,
        unit: 'kg',
      };
      const result = projectAssistedTarget(params);
      expect(result.status).toBe('constrained');
      expect(result.constraintReason).toBe('assisted_grid_resolution_limit');
      expect(result.assistanceWeight).toBe(77.5);
      expect(result.achievedEffectiveLoad).toBe(2.5);
    });

    it('supports custom positive increment', () => {
      const params: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 52.0,
        sessionBodyweight: 100.0,
        targetReps: 10,
        targetRPE: 8.0,
        unit: 'lb',
        increment: 5.0,
      };
      const result = projectAssistedTarget(params);
      // unrounded = 48 -> round to 5 lb = 50.0 lb
      expect(result.assistanceWeight).toBe(50.0);
      expect(result.achievedEffectiveLoad).toBe(50.0);
    });

    it('bypasses invalid increment or non-finite inputs and invalid RPE / repetitions', () => {
      const invalidIncZero: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: 100.0,
        targetReps: 10,
        targetRPE: 8.0,
        unit: 'kg',
        increment: 0,
      };
      expect(projectAssistedTarget(invalidIncZero).status).toBe('bypassed');

      const invalidIncNegative: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: 100.0,
        targetReps: 10,
        targetRPE: 8.0,
        unit: 'kg',
        increment: -2.5,
      };
      expect(projectAssistedTarget(invalidIncNegative).status).toBe('bypassed');

      const invalidIncNonFinite: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: 100.0,
        targetReps: 10,
        targetRPE: 8.0,
        unit: 'kg',
        increment: Number.NaN,
      };
      expect(projectAssistedTarget(invalidIncNonFinite).status).toBe('bypassed');

      const nonFiniteBw: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: Number.NaN,
        targetReps: 10,
        targetRPE: 8.0,
        unit: 'kg',
      };
      expect(projectAssistedTarget(nonFiniteBw).status).toBe('bypassed');

      const invalidRpeHigh: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: 100.0,
        targetReps: 10,
        targetRPE: 10.5,
        unit: 'kg',
      };
      expect(projectAssistedTarget(invalidRpeHigh).status).toBe('bypassed');

      const invalidRpeLow: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: 100.0,
        targetReps: 10,
        targetRPE: 5.5,
        unit: 'kg',
      };
      expect(projectAssistedTarget(invalidRpeLow).status).toBe('bypassed');

      const invalidRpeStep: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: 100.0,
        targetReps: 10,
        targetRPE: 6.25,
        unit: 'kg',
      };
      expect(projectAssistedTarget(invalidRpeStep).status).toBe('bypassed');

      const fractionalReps: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: 100.0,
        targetReps: 8.5,
        targetRPE: 8.0,
        unit: 'kg',
      };
      expect(projectAssistedTarget(fractionalReps).status).toBe('bypassed');

      const zeroReps: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 50.0,
        sessionBodyweight: 100.0,
        targetReps: 0,
        targetRPE: 8.0,
        unit: 'kg',
      };
      expect(projectAssistedTarget(zeroReps).status).toBe('bypassed');
    });

    it('preserves target repetitions and RPE exactly', () => {
      const params: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 45.0,
        sessionBodyweight: 90.0,
        targetReps: 7,
        targetRPE: 7.5,
        unit: 'kg',
      };
      const result = projectAssistedTarget(params);
      expect(result.reps).toBe(7);
      expect(result.rpe).toBe(7.5);
    });

    it('verifies independent kg and lb quantization and bounded divergence <= 1.816990 kg', () => {
      const bwKg = 100.0;
      const targetLoadKg = 43.26;

      const metricRes = projectAssistedTarget({
        targetEffectiveLoad: targetLoadKg,
        sessionBodyweight: bwKg,
        targetReps: 12,
        targetRPE: 8.0,
        unit: 'kg',
      });
      expect(metricRes.assistanceWeight).toBe(57.5);
      expect(metricRes.achievedEffectiveLoad).toBe(42.5);

      const bwLb = convertWeightUnit(bwKg, 'kg', 'lb');
      const targetLoadLb = convertWeightUnit(targetLoadKg, 'kg', 'lb');

      const imperialRes = projectAssistedTarget({
        targetEffectiveLoad: targetLoadLb,
        sessionBodyweight: bwLb,
        targetReps: 12,
        targetRPE: 8.0,
        unit: 'lb',
      });
      expect(imperialRes.assistanceWeight).toBe(125.0);

      const imperialAchievedInKg = convertWeightUnit(imperialRes.achievedEffectiveLoad, 'lb', 'kg');
      const divergence = Math.abs(imperialAchievedInKg - metricRes.achievedEffectiveLoad);

      expect(divergence).toBeCloseTo(0.800958, 4);
      // Combined conservative theoretical bound: 1.25 kg + 0.5669904625 kg = 1.8169904625 kg
      expect(divergence).toBeLessThanOrEqual(1.8169904625);
    });

    it('preserves input immutability and is idempotent', () => {
      const params: ProjectAssistedTargetParams = {
        targetEffectiveLoad: 43.26,
        sessionBodyweight: 100.0,
        targetReps: 12,
        targetRPE: 8.0,
        unit: 'kg',
      };
      const copy = JSON.parse(JSON.stringify(params));
      const res1 = projectAssistedTarget(params);
      const res2 = projectAssistedTarget(params);

      expect(res1).toEqual(res2);
      expect(params).toEqual(copy);
    });
  });

  describe('solveBodyweightRepTarget', () => {
    it('returns quantized status for 80 kg BW with target e1RM 120 kg at RPE 8.0', () => {
      const params: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 1,
        maxReps: 30,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      // 10 reps @ 8.0: multiplier = 0.680 -> achieved e1RM = 80 / 0.680 = 117.6470588 kg
      expect(result.status).toBe('quantized');
      expect(result.reps).toBe(10);
      expect(result.displayWeight).toBe(0);
      expect(result.sessionEffectiveLoad).toBe(80.0);
      expect(result.rpe).toBe(8.0);
      expect(result.targetE1RM).toBe(120.0);
      expect(result.achievedE1RM).toBeCloseTo(80 / 0.680, 4);
    });

    it('returns exact status when target e1RM matches candidate achieved e1RM within 0.0001', () => {
      const exactE1RM = 80 / 0.680; // 117.6470588235294
      const params: SolveBodyweightRepParams = {
        targetE1RM: exactE1RM,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 1,
        maxReps: 30,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      expect(result.status).toBe('exact');
      expect(result.reps).toBe(10);
      expect(result.achievedE1RM).toBeCloseTo(exactE1RM, 6);
    });

    it('returns exact status at the exact minimum boundary', () => {
      const minMult = getRTSMultiplier(5, 8.0)!;
      const exactMinE1RM = 80.0 / minMult;
      const params: SolveBodyweightRepParams = {
        targetE1RM: exactMinE1RM,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 8,
        minReps: 5,
        maxReps: 15,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      expect(result.status).toBe('exact');
      expect(result.reps).toBe(5);
      expect(result.achievedE1RM).toBeCloseTo(exactMinE1RM, 6);
      expect(result.constraintReason).toBeUndefined();
    });

    it('returns exact status at the exact maximum boundary', () => {
      const maxMult = getRTSMultiplier(15, 8.0)!;
      const exactMaxE1RM = 80.0 / maxMult;
      const params: SolveBodyweightRepParams = {
        targetE1RM: exactMaxE1RM,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 5,
        maxReps: 15,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      expect(result.status).toBe('exact');
      expect(result.reps).toBe(15);
      expect(result.achievedE1RM).toBeCloseTo(exactMaxE1RM, 6);
      expect(result.constraintReason).toBeUndefined();
    });

    it('returns quantized status with undefined constraintReason when selecting a boundary inside the expressible interval', () => {
      const minE1RM = 80.0 / getRTSMultiplier(5, 8.0)!; // 99.1325898...
      const nextE1RM = 80.0 / getRTSMultiplier(6, 8.0)!; // 102.6957637...
      // Target is strictly between minE1RM and nextE1RM, but much closer to minE1RM
      const targetE1RM = minE1RM + 0.2; // e.g. ~99.3326 kg (strictly inside interval [minE1RM, maxE1RM])
      const params: SolveBodyweightRepParams = {
        targetE1RM,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 5,
        maxReps: 15,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      expect(result.reps).toBe(5);
      expect(result.status).toBe('quantized');
      expect(result.constraintReason).toBeUndefined();
    });

    it('selects the closest candidate by achieved e1RM (e.g. 9 reps for 114 kg target e1RM)', () => {
      const params: SolveBodyweightRepParams = {
        targetE1RM: 114.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 12,
        minReps: 1,
        maxReps: 30,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      // Reps 9: 80 / 0.702 = 113.960 kg (delta = 0.040 kg)
      // Reps 10: 80 / 0.680 = 117.647 kg (delta = 3.647 kg)
      expect(result.reps).toBe(9);
      expect(result.status).toBe('quantized');
    });

    it('clamps to minReps with bodyweight_min_reps_exceeded when target e1RM is below expressible range', () => {
      const params: SolveBodyweightRepParams = {
        targetE1RM: 40.0, // At 80 kg BW, 1 rep @ RPE 10.0 yields e1RM = 80 kg; 40 kg is far below
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 5,
        maxReps: 20,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      expect(result.status).toBe('constrained');
      expect(result.constraintReason).toBe('bodyweight_min_reps_exceeded');
      expect(result.reps).toBe(5);
    });

    it('clamps to maxReps with bodyweight_max_reps_exceeded when target e1RM is above expressible range', () => {
      const params: SolveBodyweightRepParams = {
        targetE1RM: 300.0, // High capacity exceeding maxReps
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 5,
        maxReps: 15,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      expect(result.status).toBe('constrained');
      expect(result.constraintReason).toBe('bodyweight_max_reps_exceeded');
      expect(result.reps).toBe(15);
    });

    it('breaks genuine equal-error ties toward the candidate closest to anchorReps', () => {
      // Candidate 8: 80 / 0.728 = 109.89010989 kg
      // Candidate 9: 80 / 0.702 = 113.96011396 kg
      // Exact arithmetic midpoint = (109.89010989 + 113.96011396) / 2 = 111.925111925 kg
      const e1 = 80.0 / 0.728;
      const e2 = 80.0 / 0.702;
      const midpointTarget = (e1 + e2) / 2;

      // Verify errors are identical within tie tolerance (1e-6)
      const err1 = Math.abs(e1 - midpointTarget);
      const err2 = Math.abs(e2 - midpointTarget);
      expect(Math.abs(err1 - err2)).toBeLessThan(1e-6);

      // Anchor at lower candidate (8) -> Candidate 8 must win
      const resultAnchor8 = solveBodyweightRepTarget({
        targetE1RM: midpointTarget,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 8,
        minReps: 8,
        maxReps: 9,
        unit: 'kg',
      });
      expect(resultAnchor8.reps).toBe(8);

      // Anchor at higher candidate (9) -> Candidate 9 must win
      const resultAnchor9 = solveBodyweightRepTarget({
        targetE1RM: midpointTarget,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 9,
        minReps: 8,
        maxReps: 9,
        unit: 'kg',
      });
      expect(resultAnchor9.reps).toBe(9);
    });

    it('documents defensive secondary lower-repetition tie-break behavior on equidistant anchor', () => {
      // Under dense integer evaluation [minReps, maxReps] and strictly monotonic RTS multipliers,
      // any anchor equidistant between two candidates (e.g. anchor 9 between candidates 8 and 10)
      // evaluates candidate 9, which sits strictly between 8 and 10 and has a strictly lower
      // primary error to the midpoint target. Hence candidate 9 wins on primary error.
      // The secondary tie branch (r < bestReps) is a defensive deterministic safeguard.
      const params: SolveBodyweightRepParams = {
        targetE1RM: 114.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 9,
        minReps: 8,
        maxReps: 10,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      expect(result.reps).toBe(9);
      expect(result.status).toBe('quantized');
    });

    it('handles high repetition counts (> 12) via RTS-anchored Epley extension', () => {
      const params: SolveBodyweightRepParams = {
        targetE1RM: 150.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 15,
        minReps: 10,
        maxReps: 30,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      expect(result.reps).toBeGreaterThan(12);
      expect(result.status).toBe('quantized');
    });

    it('bypasses invalid inputs (invalid RPE, reversed bounds, non-finite values, invalid anchor)', () => {
      const invalidRpeLow: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 5.5,
        anchorReps: 10,
        minReps: 1,
        maxReps: 20,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(invalidRpeLow).status).toBe('bypassed');

      const invalidRpeHigh: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 10.5,
        anchorReps: 10,
        minReps: 1,
        maxReps: 20,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(invalidRpeHigh).status).toBe('bypassed');

      const invalidRpeStep: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.3,
        anchorReps: 10,
        minReps: 1,
        maxReps: 20,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(invalidRpeStep).status).toBe('bypassed');

      const reversedBounds: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 20,
        maxReps: 10,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(reversedBounds).status).toBe('bypassed');

      const anchorBelowBounds: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 3,
        minReps: 5,
        maxReps: 15,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(anchorBelowBounds).status).toBe('bypassed');

      const anchorAboveBounds: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 18,
        minReps: 5,
        maxReps: 15,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(anchorAboveBounds).status).toBe('bypassed');

      const fractionalAnchor: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 8.5,
        minReps: 5,
        maxReps: 15,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(fractionalAnchor).status).toBe('bypassed');

      const fractionalMinReps: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 8,
        minReps: 5.5,
        maxReps: 15,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(fractionalMinReps).status).toBe('bypassed');

      const fractionalMaxReps: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 8,
        minReps: 5,
        maxReps: 15.5,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(fractionalMaxReps).status).toBe('bypassed');

      const nonPositiveTargetZero: SolveBodyweightRepParams = {
        targetE1RM: 0.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 1,
        maxReps: 20,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(nonPositiveTargetZero).status).toBe('bypassed');

      const nonPositiveTargetNegative: SolveBodyweightRepParams = {
        targetE1RM: -50.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 1,
        maxReps: 20,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(nonPositiveTargetNegative).status).toBe('bypassed');

      const nonPositiveBwZero: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 0.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 1,
        maxReps: 20,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(nonPositiveBwZero).status).toBe('bypassed');

      const nonPositiveBwNegative: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: -80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 1,
        maxReps: 20,
        unit: 'kg',
      };
      expect(solveBodyweightRepTarget(nonPositiveBwNegative).status).toBe('bypassed');
    });

    it('strictly guarantees displayWeight is 0', () => {
      const params: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 1,
        maxReps: 20,
        unit: 'kg',
      };
      const result = solveBodyweightRepTarget(params);
      expect(result.displayWeight).toBe(0);
    });

    it('preserves input immutability and is idempotent', () => {
      const params: SolveBodyweightRepParams = {
        targetE1RM: 120.0,
        sessionBodyweight: 80.0,
        targetRPE: 8.0,
        anchorReps: 10,
        minReps: 1,
        maxReps: 20,
        unit: 'kg',
      };
      const copy = JSON.parse(JSON.stringify(params));
      const res1 = solveBodyweightRepTarget(params);
      const res2 = solveBodyweightRepTarget(params);

      expect(res1).toEqual(res2);
      expect(params).toEqual(copy);
    });
  });
});
