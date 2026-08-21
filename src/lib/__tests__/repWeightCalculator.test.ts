/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  calculateEquivalentWorkingWeight,
  solveEquivalentRepetitions,
  isCalculatorSupportedForModality,
  VALID_CALCULATOR_RPES,
  CALCULATOR_REP_PRESETS,
  validateManualRepsEntry,
  validateManualWeightEntry,
  stepRepsValue,
  stepWeightValue,
} from '../repWeightCalculator';
import { calculateE1RMForSet, getRTSMultiplier } from '../rpeMath';

describe('repWeightCalculator — Canonical-Math & Identity Invariants', () => {
  describe('1. Identity Invariants (Base Set -> Identical Target Reps/RPE)', () => {
    it('returns exact 100 kg for 100 kg × 10 @ RPE 6.0 -> 10 reps @ RPE 6.0', () => {
      const result = calculateEquivalentWorkingWeight({
        baseWeight: 100,
        baseReps: 10,
        baseRpe: 6.0,
        targetReps: 10,
        targetRpe: 6.0,
      });

      expect(result.status).toBe('valid');
      expect(result.est1RM).toBeCloseTo(100 / 0.617, 5);
      expect(result.rtsMultiplier).toBe(0.617);
      expect(result.targetPercentage).toBe(62);
      expect(result.targetWeight).toBe(100.0);
    });

    it('returns exact 12.5 kg for 12.5 kg × 10 @ RPE 8.0 -> 10 reps @ RPE 8.0', () => {
      const result = calculateEquivalentWorkingWeight({
        baseWeight: 12.5,
        baseReps: 10,
        baseRpe: 8.0,
        targetReps: 10,
        targetRpe: 8.0,
      });

      expect(result.status).toBe('valid');
      expect(result.est1RM).toBeCloseTo(12.5 / 0.680, 5);
      expect(result.rtsMultiplier).toBe(0.680);
      expect(result.targetPercentage).toBe(68);
      expect(result.targetWeight).toBe(12.5);
    });

    it('returns exact 140 kg for 140 kg × 5 @ RPE 8.5 -> 5 reps @ RPE 8.5', () => {
      const result = calculateEquivalentWorkingWeight({
        baseWeight: 140,
        baseReps: 5,
        baseRpe: 8.5,
        targetReps: 5,
        targetRpe: 8.5,
      });

      expect(result.status).toBe('valid');
      expect(result.targetWeight).toBe(140.0);
    });

    it('returns exact 220 lb for 220 lb × 5 @ RPE 8.0 -> 5 reps @ RPE 8.0', () => {
      const result = calculateEquivalentWorkingWeight({
        baseWeight: 220,
        baseReps: 5,
        baseRpe: 8.0,
        targetReps: 5,
        targetRpe: 8.0,
      });

      expect(result.status).toBe('valid');
      expect(result.targetWeight).toBe(220.0);
    });

    it('returns exact 60 kg for 60 kg × 1 @ RPE 10.0 -> 1 rep @ RPE 10.0', () => {
      const result = calculateEquivalentWorkingWeight({
        baseWeight: 60,
        baseReps: 1,
        baseRpe: 10.0,
        targetReps: 1,
        targetRpe: 10.0,
      });

      expect(result.status).toBe('valid');
      expect(result.targetWeight).toBe(60.0);
    });
  });

  describe('2. Canonical Rep and RPE Translations', () => {
    it('translates 100 kg × 10 @ RPE 8.0 to 5 reps @ RPE 8.0 -> 117.5 kg', () => {
      const result = calculateEquivalentWorkingWeight({
        baseWeight: 100,
        baseReps: 10,
        baseRpe: 8.0,
        targetReps: 5,
        targetRpe: 8.0,
      });

      // est1RM = 100 / 0.680 = 147.0588235...
      // unrounded target = 147.0588235... * 0.807 = 118.67647...
      // roundToNearest25(118.67647) = 117.5
      expect(result.status).toBe('valid');
      expect(result.est1RM).toBeCloseTo(100 / 0.680, 5);
      expect(result.rtsMultiplier).toBe(0.807);
      expect(result.targetPercentage).toBe(81);
      expect(result.targetWeight).toBe(117.5);
    });

    it('translates 100 kg × 5 @ RPE 7.0 to 5 reps @ RPE 9.0 -> 107.5 kg', () => {
      const result = calculateEquivalentWorkingWeight({
        baseWeight: 100,
        baseReps: 5,
        baseRpe: 7.0,
        targetReps: 5,
        targetRpe: 9.0,
      });

      // est1RM = 100 / 0.779 = 128.3697047...
      // unrounded target = 128.3697047... * 0.835 = 107.188703...
      // roundToNearest25(107.188703) = 107.5
      expect(result.status).toBe('valid');
      expect(result.est1RM).toBeCloseTo(100 / 0.779, 5);
      expect(result.rtsMultiplier).toBe(0.835);
      expect(result.targetPercentage).toBe(84);
      expect(result.targetWeight).toBe(107.5);
    });

    it('translates 80 kg × 8 @ RPE 7.5 to 12 reps @ RPE 8.0', () => {
      const result = calculateEquivalentWorkingWeight({
        baseWeight: 80,
        baseReps: 8,
        baseRpe: 7.5,
        targetReps: 12,
        targetRpe: 8.0,
      });

      const canonicalE1RM = calculateE1RMForSet(80, 8, 7.5)!;
      const targetMult = getRTSMultiplier(12, 8.0);
      expect(result.status).toBe('valid');
      expect(result.est1RM).toBeCloseTo(canonicalE1RM, 5);
      expect(result.rtsMultiplier).toBe(targetMult);
    });
  });

  describe('3. Missing-RPE Handling (Canonical Epley Fallback)', () => {
    it('uses canonical reps-only Epley formula when base RPE is null', () => {
      const result = calculateEquivalentWorkingWeight({
        baseWeight: 100,
        baseReps: 10,
        baseRpe: null,
        targetReps: 10,
        targetRpe: 8.0,
      });

      // Epley e1RM: 100 * (1 + 10 / 30) = 133.33333333333334
      // Target: 133.33333333333334 * 0.680 = 90.66666666666667 -> 90.0 kg
      expect(result.status).toBe('valid');
      expect(result.est1RM).toBeCloseTo(100 * (1 + 10 / 30), 5);
      expect(result.rtsMultiplier).toBe(0.680);
      expect(result.targetWeight).toBe(90.0);
    });

    it('uses canonical reps-only Epley formula when base RPE is undefined or 0', () => {
      const resultUndefined = calculateEquivalentWorkingWeight({
        baseWeight: 100,
        baseReps: 10,
        baseRpe: undefined,
        targetReps: 10,
        targetRpe: 8.0,
      });
      const resultZero = calculateEquivalentWorkingWeight({
        baseWeight: 100,
        baseReps: 10,
        baseRpe: 0,
        targetReps: 10,
        targetRpe: 8.0,
      });

      expect(resultUndefined.targetWeight).toBe(90.0);
      expect(resultZero.targetWeight).toBe(90.0);
    });
  });

  describe('4. Missing and Invalid Input Boundaries', () => {
    it('returns invalid status for missing or zero/negative base weight', () => {
      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: null,
          baseReps: 10,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');

      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: undefined,
          baseReps: 10,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');

      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: 0,
          baseReps: 10,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');

      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: -50,
          baseReps: 10,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');

      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: NaN,
          baseReps: 10,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');
    });

    it('returns invalid status for missing or invalid base reps', () => {
      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: 100,
          baseReps: null,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');

      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: 100,
          baseReps: 0,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');

      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: 100,
          baseReps: -5,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');

      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: 100,
          baseReps: 5.5,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');
    });

    it('returns invalid status for invalid target reps or RPE', () => {
      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: 100,
          baseReps: 10,
          baseRpe: 8.0,
          targetReps: 0,
          targetRpe: 8.0,
        }).status
      ).toBe('invalid');

      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: 100,
          baseReps: 10,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 5.0, // below 6.0
        }).status
      ).toBe('invalid');

      expect(
        calculateEquivalentWorkingWeight({
          baseWeight: 100,
          baseReps: 10,
          baseRpe: 8.0,
          targetReps: 10,
          targetRpe: 10.5, // above 10.0
        }).status
      ).toBe('invalid');
    });
  });

  describe('5. Complete RPE Half-Steps Coverage', () => {
    it('contains exactly 9 canonical half-steps from 6.0 to 10.0', () => {
      expect(VALID_CALCULATOR_RPES).toEqual([
        6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0,
      ]);
    });

    it('evaluates every valid RPE half-step correctly', () => {
      for (const rpe of VALID_CALCULATOR_RPES) {
        const result = calculateEquivalentWorkingWeight({
          baseWeight: 100,
          baseReps: 5,
          baseRpe: rpe,
          targetReps: 5,
          targetRpe: rpe,
        });

        expect(result.status).toBe('valid');
        expect(result.targetWeight).toBe(100.0);
      }
    });

    it('includes standard rep presets', () => {
      expect(CALCULATOR_REP_PRESETS).toEqual([1, 3, 5, 8, 10, 12, 15, 20]);
    });
  });

  describe('6. Modality Boundary Verification', () => {
    it('supports weighted and unassigned modalities', () => {
      expect(isCalculatorSupportedForModality('weighted')).toBe(true);
      expect(isCalculatorSupportedForModality(undefined)).toBe(true);
      expect(isCalculatorSupportedForModality(null)).toBe(true);
      expect(isCalculatorSupportedForModality('')).toBe(true);
    });

    it('rejects unsupported non-weighted modalities', () => {
      expect(isCalculatorSupportedForModality('bodyweight')).toBe(false);
      expect(isCalculatorSupportedForModality('assisted')).toBe(false);
      expect(isCalculatorSupportedForModality('timed')).toBe(false);
      expect(isCalculatorSupportedForModality('distance')).toBe(false);
      expect(isCalculatorSupportedForModality('distance_loaded')).toBe(false);
    });
  });

  describe('7. Pure Immutability / Zero State Mutation', () => {
    it('does not mutate input arguments', () => {
      const input = {
        baseWeight: 100,
        baseReps: 10,
        baseRpe: 8.0,
        targetReps: 5,
        targetRpe: 8.0,
      };
      const snapshot = JSON.stringify(input);

      calculateEquivalentWorkingWeight(input);

      expect(JSON.stringify(input)).toBe(snapshot);
    });
  });

  describe('solveEquivalentRepetitions — Inverse Repetition Solver', () => {
    describe('1. Identity & Exact Solver Invariants', () => {
      it('returns exact 10 reps for 100 kg × 10 @ RPE 6.0 with available 100 kg @ RPE 6.0', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 100,
          baseReps: 10,
          baseRPE: 6.0,
          availableWeight: 100,
          targetRPE: 6.0,
        });

        expect(result.status).toBe('exact');
        expect(result.targetReps).toBe(10);
        expect(result.targetRPE).toBe(6.0);
        expect(result.achievedE1RM).toBeCloseTo(100 / 0.617, 5);
        expect(result.capacityDiff).toBeCloseTo(0, 3);
      });

      it('returns exact 10 reps for 12.5 kg × 10 @ RPE 8.0 with available 12.5 kg @ RPE 8.0', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 12.5,
          baseReps: 10,
          baseRPE: 8.0,
          availableWeight: 12.5,
          targetRPE: 8.0,
        });

        expect(result.status).toBe('exact');
        expect(result.targetReps).toBe(10);
        expect(result.achievedE1RM).toBeCloseTo(12.5 / 0.680, 5);
        expect(result.capacityDiff).toBeCloseTo(0, 3);
      });

      it('returns exact 5 reps for 140 kg × 5 @ RPE 8.5 with available 140 kg @ RPE 8.5', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 140,
          baseReps: 5,
          baseRPE: 8.5,
          availableWeight: 140,
          targetRPE: 8.5,
        });

        expect(result.status).toBe('exact');
        expect(result.targetReps).toBe(5);
        expect(result.capacityDiff).toBeCloseTo(0, 3);
      });

      it('returns exact 5 reps for 220 lb × 5 @ RPE 8.0 with available 220 lb @ RPE 8.0', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 220,
          baseReps: 5,
          baseRPE: 8.0,
          availableWeight: 220,
          targetRPE: 8.0,
          unit: 'lb',
        });

        expect(result.status).toBe('exact');
        expect(result.targetReps).toBe(5);
        expect(result.unit).toBe('lb');
        expect(result.capacityDiff).toBeCloseTo(0, 3);
      });
    });

    describe('2. Weight-to-Rep Translations and Status Matching', () => {
      it('solves 100 kg × 10 @ RPE 8.0 with available 117.5 kg @ RPE 8.0 -> 5 reps (quantized/approximate)', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 100,
          baseReps: 10,
          baseRPE: 8.0,
          availableWeight: 117.5,
          targetRPE: 8.0,
        });

        // base e1RM = 100 / 0.680 = 147.0588
        // 5 reps @ 8.0 -> 117.5 / 0.807 = 145.60
        expect(result.targetReps).toBe(5);
        expect(result.status).toBe('quantized');
        expect(result.baseE1RM).toBeCloseTo(100 / 0.680, 5);
      });

      it('solves 100 kg × 5 @ RPE 7.0 with available 107.5 kg @ RPE 9.0 -> 5 reps', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 100,
          baseReps: 5,
          baseRPE: 7.0,
          availableWeight: 107.5,
          targetRPE: 9.0,
        });

        // base e1RM = 100 / 0.779 = 128.3697
        // 5 reps @ 9.0 -> 107.5 / 0.835 = 128.7425
        expect(result.targetReps).toBe(5);
        expect(result.status).toBe('quantized');
      });

      it('solves lighter available weight into higher repetitions', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 100,
          baseReps: 5,
          baseRPE: 8.0,
          availableWeight: 75,
          targetRPE: 8.0,
        });

        // base e1RM = 100 / 0.807 = 123.9157
        // target mult for 75 kg = 75 / 123.9157 = 0.6052
        // at RPE 8.0, 13 reps has multiplier ~0.6033 (closest match to 0.6052)
        expect(result.targetReps).toBe(13);
      });
    });

    describe('3. Boundary Constraints (1–25 Rep Range)', () => {
      it('returns constrained status and 1 rep when available weight exceeds 1-rep capacity', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 50,
          baseReps: 10,
          baseRPE: 8.0,
          availableWeight: 500,
          targetRPE: 10.0,
        });

        expect(result.status).toBe('constrained');
        expect(result.targetReps).toBe(1);
        expect(result.constraintReason).toContain('exceeds capacity');
      });

      it('returns constrained status and 25 reps when available weight is lower than 25-rep capacity', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 200,
          baseReps: 5,
          baseRPE: 9.0,
          availableWeight: 10,
          targetRPE: 6.0,
        });

        expect(result.status).toBe('constrained');
        expect(result.targetReps).toBe(25);
        expect(result.constraintReason).toContain('lighter than capacity');
      });
    });

    describe('4. Missing & Invalid Input Boundaries (Bypassed)', () => {
      it('returns bypassed status for missing or invalid base weight', () => {
        expect(
          solveEquivalentRepetitions({
            baseWeight: null,
            baseReps: 10,
            baseRPE: 8.0,
            availableWeight: 100,
            targetRPE: 8.0,
          }).status
        ).toBe('bypassed');

        expect(
          solveEquivalentRepetitions({
            baseWeight: 0,
            baseReps: 10,
            baseRPE: 8.0,
            availableWeight: 100,
            targetRPE: 8.0,
          }).status
        ).toBe('bypassed');

        expect(
          solveEquivalentRepetitions({
            baseWeight: -50,
            baseReps: 10,
            baseRPE: 8.0,
            availableWeight: 100,
            targetRPE: 8.0,
          }).status
        ).toBe('bypassed');
      });

      it('returns bypassed status for missing or invalid base reps', () => {
        expect(
          solveEquivalentRepetitions({
            baseWeight: 100,
            baseReps: null,
            baseRPE: 8.0,
            availableWeight: 100,
            targetRPE: 8.0,
          }).status
        ).toBe('bypassed');

        expect(
          solveEquivalentRepetitions({
            baseWeight: 100,
            baseReps: 0,
            baseRPE: 8.0,
            availableWeight: 100,
            targetRPE: 8.0,
          }).status
        ).toBe('bypassed');

        expect(
          solveEquivalentRepetitions({
            baseWeight: 100,
            baseReps: 3.5,
            baseRPE: 8.0,
            availableWeight: 100,
            targetRPE: 8.0,
          }).status
        ).toBe('bypassed');
      });

      it('returns bypassed status for missing or invalid available weight', () => {
        expect(
          solveEquivalentRepetitions({
            baseWeight: 100,
            baseReps: 10,
            baseRPE: 8.0,
            availableWeight: null,
            targetRPE: 8.0,
          }).status
        ).toBe('bypassed');

        expect(
          solveEquivalentRepetitions({
            baseWeight: 100,
            baseReps: 10,
            baseRPE: 8.0,
            availableWeight: 0,
            targetRPE: 8.0,
          }).status
        ).toBe('bypassed');

        expect(
          solveEquivalentRepetitions({
            baseWeight: 100,
            baseReps: 10,
            baseRPE: 8.0,
            availableWeight: -10,
            targetRPE: 8.0,
          }).status
        ).toBe('bypassed');
      });

      it('returns bypassed status for invalid target RPE', () => {
        expect(
          solveEquivalentRepetitions({
            baseWeight: 100,
            baseReps: 10,
            baseRPE: 8.0,
            availableWeight: 100,
            targetRPE: undefined,
          }).status
        ).toBe('bypassed');

        expect(
          solveEquivalentRepetitions({
            baseWeight: 100,
            baseReps: 10,
            baseRPE: 8.0,
            availableWeight: 100,
            targetRPE: 5.5,
          }).status
        ).toBe('bypassed');

        expect(
          solveEquivalentRepetitions({
            baseWeight: 100,
            baseReps: 10,
            baseRPE: 8.0,
            availableWeight: 100,
            targetRPE: 10.5,
          }).status
        ).toBe('bypassed');
      });

      it('correctly uses reps-only Epley fallback when base RPE is missing', () => {
        const result = solveEquivalentRepetitions({
          baseWeight: 100,
          baseReps: 10,
          baseRPE: null,
          availableWeight: 90,
          targetRPE: 8.0,
        });

        // Epley e1RM = 100 * (1 + 10 / 30) = 133.3333
        // mult for 90 kg = 90 / 133.3333 = 0.675
        // at RPE 8.0, 10 reps = 0.680 (closest match)
        expect(result.status).toBe('quantized');
        expect(result.baseE1RM).toBeCloseTo(100 * (1 + 10 / 30), 5);
        expect(result.targetReps).toBe(10);
      });
    });

    describe('5. Pure Immutability', () => {
      it('does not mutate input arguments', () => {
        const input = {
          baseWeight: 100,
          baseReps: 10,
          baseRPE: 8.0,
          availableWeight: 110,
          targetRPE: 8.0,
        };
        const snapshot = JSON.stringify(input);

        solveEquivalentRepetitions(input);

        expect(JSON.stringify(input)).toBe(snapshot);
      });
    });
  });

  describe('repWeightCalculator — Direct Entry & Stepping Helpers', () => {
    describe('1. Manual Reps Entry Validation (validateManualRepsEntry)', () => {
      it('accepts valid integers 1 through 25 as number and string', () => {
        expect(validateManualRepsEntry(1)).toEqual({ isValid: true, value: 1, errorReason: null });
        expect(validateManualRepsEntry(10)).toEqual({ isValid: true, value: 10, errorReason: null });
        expect(validateManualRepsEntry(25)).toEqual({ isValid: true, value: 25, errorReason: null });
        expect(validateManualRepsEntry('1')).toEqual({ isValid: true, value: 1, errorReason: null });
        expect(validateManualRepsEntry(' 12 ')).toEqual({ isValid: true, value: 12, errorReason: null });
        expect(validateManualRepsEntry('25')).toEqual({ isValid: true, value: 25, errorReason: null });
      });

      it('rejects empty, null, and undefined inputs without throwing', () => {
        expect(validateManualRepsEntry('')).toEqual({
          isValid: false,
          value: null,
          errorReason: 'Enter a whole number from 1 to 25.',
        });
        expect(validateManualRepsEntry('   ')).toEqual({
          isValid: false,
          value: null,
          errorReason: 'Enter a whole number from 1 to 25.',
        });
        expect(validateManualRepsEntry(null)).toEqual({
          isValid: false,
          value: null,
          errorReason: 'Enter a whole number from 1 to 25.',
        });
        expect(validateManualRepsEntry(undefined)).toEqual({
          isValid: false,
          value: null,
          errorReason: 'Enter a whole number from 1 to 25.',
        });
      });

      it('rejects values outside the 1..25 range', () => {
        expect(validateManualRepsEntry(0).isValid).toBe(false);
        expect(validateManualRepsEntry('0').isValid).toBe(false);
        expect(validateManualRepsEntry(-5).isValid).toBe(false);
        expect(validateManualRepsEntry('-1').isValid).toBe(false);
        expect(validateManualRepsEntry(26).isValid).toBe(false);
        expect(validateManualRepsEntry('30').isValid).toBe(false);
      });

      it('rejects non-integer numbers and malformed strings', () => {
        expect(validateManualRepsEntry(8.5).isValid).toBe(false);
        expect(validateManualRepsEntry('10.5').isValid).toBe(false);
        expect(validateManualRepsEntry('abc').isValid).toBe(false);
        expect(validateManualRepsEntry('10a').isValid).toBe(false);
        expect(validateManualRepsEntry(NaN).isValid).toBe(false);
        expect(validateManualRepsEntry(Infinity).isValid).toBe(false);
      });
    });

    describe('2. Manual Weight Entry Validation (validateManualWeightEntry)', () => {
      it('accepts valid finite positive decimals and integers', () => {
        expect(validateManualWeightEntry(9.1)).toEqual({ isValid: true, value: 9.1, errorReason: null });
        expect(validateManualWeightEntry('17.5')).toEqual({ isValid: true, value: 17.5, errorReason: null });
        expect(validateManualWeightEntry('22')).toEqual({ isValid: true, value: 22, errorReason: null });
        expect(validateManualWeightEntry('27.25')).toEqual({ isValid: true, value: 27.25, errorReason: null });
        expect(validateManualWeightEntry(100)).toEqual({ isValid: true, value: 100, errorReason: null });
      });

      it('rejects empty strings and whitespace', () => {
        expect(validateManualWeightEntry('')).toEqual({
          isValid: false,
          value: null,
          errorReason: 'Enter an available weight greater than 0.',
        });
        expect(validateManualWeightEntry('   ')).toEqual({
          isValid: false,
          value: null,
          errorReason: 'Enter an available weight greater than 0.',
        });
        expect(validateManualWeightEntry(null)).toEqual({
          isValid: false,
          value: null,
          errorReason: 'Enter an available weight greater than 0.',
        });
      });

      it('rejects zero, negative, non-numeric and non-finite values', () => {
        expect(validateManualWeightEntry(0).isValid).toBe(false);
        expect(validateManualWeightEntry('0').isValid).toBe(false);
        expect(validateManualWeightEntry(-10).isValid).toBe(false);
        expect(validateManualWeightEntry('-2.5').isValid).toBe(false);
        expect(validateManualWeightEntry('xyz').isValid).toBe(false);
        expect(validateManualWeightEntry(NaN).isValid).toBe(false);
        expect(validateManualWeightEntry(Infinity).isValid).toBe(false);
      });
    });

    describe('3. Reps Stepper Helper (stepRepsValue)', () => {
      it('increments and decrements by step while clamping to [1, 25]', () => {
        expect(stepRepsValue(10, 1)).toBe(11);
        expect(stepRepsValue(10, -1)).toBe(9);
        expect(stepRepsValue(25, 1)).toBe(25);
        expect(stepRepsValue(1, -1)).toBe(1);
        expect(stepRepsValue(0, 1)).toBe(1);
        expect(stepRepsValue(30, -1)).toBe(25);
      });
    });

    describe('4. Weight Stepper Helper (stepWeightValue)', () => {
      it('steps exact decimals by +/- 2.5 without unwanted quantization', () => {
        expect(stepWeightValue(27.25, 2.5)).toBe(29.75);
        expect(stepWeightValue(27.25, -2.5)).toBe(24.75);
        expect(stepWeightValue(9.1, 2.5)).toBe(11.6);
        expect(stepWeightValue(9.1, -2.5)).toBe(6.6);
        expect(stepWeightValue(17.5, 2.5)).toBe(20.0);
        expect(stepWeightValue(17.5, -2.5)).toBe(15.0);
      });

      it('clamps negative results at 0', () => {
        expect(stepWeightValue(1.5, -2.5)).toBe(0);
        expect(stepWeightValue(0, -2.5)).toBe(0);
      });
    });

    describe('5. Unrounded / Arbitrary Decimal Weight Solving in solveEquivalentRepetitions', () => {
      it('accurately solves equivalent reps for exact unrounded decimal weights', () => {
        // base: 100 kg x 10 @ RPE 8.0 -> est1RM = 100 / 0.680 = 147.0588
        // available weight: 27.25 kg
        const result27 = solveEquivalentRepetitions({
          baseWeight: 100,
          baseReps: 10,
          baseRPE: 8.0,
          availableWeight: 27.25,
          targetRPE: 8.0,
          unit: 'lb',
        });
        // 27.25 / 147.0588 = 0.18529... which is very low weight, constrained to 25 reps
        expect(result27.status).toBe('constrained');
        expect(result27.targetReps).toBe(25);

        // available weight: 118.5 kg (very close to 5 reps @ RPE 8.0 which requires ~118.68 kg)
        const result118 = solveEquivalentRepetitions({
          baseWeight: 100,
          baseReps: 10,
          baseRPE: 8.0,
          availableWeight: 118.5,
          targetRPE: 8.0,
          unit: 'kg',
        });
        expect(result118.status).toBe('quantized');
        expect(result118.targetReps).toBe(5);
      });
    });
  });
});
