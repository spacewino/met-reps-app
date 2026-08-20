/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  extractSetPerformanceEvidence,
  SetPerformanceEvidenceInput,
} from '../progressionEvidence';
import { calculateE1RMForSet } from '../rpeMath';

describe('extractSetPerformanceEvidence', () => {
  describe('Weighted Modality Evidence', () => {
    it('extracts valid weighted historical RTS evidence', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0, isCompleted: true },
        targetUnit: 'kg',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.effectiveLoad).toBe(100);
        expect(result.reps).toBe(8);
        expect(result.rpe).toBe(8.0);
        expect(result.targetUnit).toBe('kg');
        // RTS table: 8 reps @ 8.0 = 0.728 -> e1RM = 100 / 0.728 = 137.362637...
        expect(result.e1RM).toBeCloseTo(100 / 0.728, 4);
      }
    });

    it('handles historical missing-RPE via reps-only Epley fallback with calculateE1RMForSet parity', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 10, rpe: null, isCompleted: true },
        targetUnit: 'kg',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.effectiveLoad).toBe(100);
        expect(result.reps).toBe(10);
        expect(result.rpe).toBeNull();
        // Epley: 100 * (1 + 10 / 30) = 133.3333...
        expect(result.e1RM).toBeCloseTo(133.33333, 4);
        // Explicit parity with canonical calculateE1RMForSet
        const canonicalE1RM = calculateE1RMForSet(100, 10, null);
        expect(result.e1RM).toBe(canonicalE1RM);
      }
    });

    it('rejects invalid explicit historical RPE (outside 6.0..10.0 or non-half-step)', () => {
      const outOfRangeInput: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 4.5, isCompleted: true },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(outOfRangeInput)).toEqual({
        status: 'bypassed',
        bypassReason: 'invalid_explicit_rpe',
      });

      const invalidStepInput: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.3, isCompleted: true },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(invalidStepInput)).toEqual({
        status: 'bypassed',
        bypassReason: 'invalid_explicit_rpe',
      });
    });

    it('requires explicit valid RPE for live context', () => {
      const missingRpeLive: SetPerformanceEvidenceInput = {
        context: 'live',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: null },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(missingRpeLive)).toEqual({
        status: 'bypassed',
        bypassReason: 'missing_live_rpe',
      });

      const zeroRpeLive: SetPerformanceEvidenceInput = {
        context: 'live',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 0 },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(zeroRpeLive)).toEqual({
        status: 'bypassed',
        bypassReason: 'missing_live_rpe',
      });

      const validRpeLive: SetPerformanceEvidenceInput = {
        context: 'live',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.5 },
        targetUnit: 'kg',
      };
      const result = extractSetPerformanceEvidence(validRpeLive);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.rpe).toBe(8.5);
      }
    });

    it('converts weight between units if sourceUnit differs from targetUnit', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
        sourceUnit: 'kg',
        targetUnit: 'lb',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.targetUnit).toBe('lb');
        expect(result.effectiveLoad).toBeCloseTo(220.46226, 4);
      }
    });
  });

  describe('Completion Rules Across Contexts', () => {
    it('excludes historical sets where isCompleted is explicitly false', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0, isCompleted: false },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(input)).toEqual({
        status: 'bypassed',
        bypassReason: 'uncompleted_historical_set',
      });
    });

    it('includes legacy historical sets where isCompleted is undefined', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0 },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(input).status).toBe('valid');
    });

    it('allows live committed evidence with isCompleted false or undefined', () => {
      const inputUncompleted: SetPerformanceEvidenceInput = {
        context: 'live',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0, isCompleted: false },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(inputUncompleted).status).toBe('valid');

      const inputUndefined: SetPerformanceEvidenceInput = {
        context: 'live',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0 },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(inputUndefined).status).toBe('valid');
    });
  });

  describe('Universal Exclusions', () => {
    it('excludes warm-up sets', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0, isWarmup: true, isCompleted: true },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(input)).toEqual({
        status: 'bypassed',
        bypassReason: 'warmup_set',
      });
    });

    it('excludes skipped sets and skipped exercises', () => {
      const skippedSet: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0, isSkipped: true, isCompleted: true },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(skippedSet)).toEqual({
        status: 'bypassed',
        bypassReason: 'skipped_set',
      });

      const skippedExercise: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0, isCompleted: true },
        exerciseIsSkipped: true,
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(skippedExercise)).toEqual({
        status: 'bypassed',
        bypassReason: 'skipped_exercise',
      });
    });

    it('excludes loose form', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0, form: 'loose', isCompleted: true },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(input)).toEqual({
        status: 'bypassed',
        bypassReason: 'loose_form',
      });
    });

    it('excludes drop sets (isDropSet: true or dropSubSets populated)', () => {
      const dropSetFlag: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0, isDropSet: true, isCompleted: true },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(dropSetFlag)).toEqual({
        status: 'bypassed',
        bypassReason: 'drop_set',
      });

      const dropSubSets: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: {
          setNumber: 1,
          weight: 100,
          reps: 8,
          rpe: 8.0,
          dropSubSets: [{ weight: 80, reps: 5 }],
          isCompleted: true,
        },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(dropSubSets)).toEqual({
        status: 'bypassed',
        bypassReason: 'drop_set',
      });
    });

    it('excludes invalid repetitions', () => {
      const zeroReps: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 0, rpe: 8.0, isCompleted: true },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(zeroReps)).toEqual({
        status: 'bypassed',
        bypassReason: 'invalid_reps',
      });

      const fractionalReps: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'weighted',
        set: { setNumber: 1, weight: 100, reps: 8.5, rpe: 8.0, isCompleted: true },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(fractionalReps)).toEqual({
        status: 'bypassed',
        bypassReason: 'invalid_reps',
      });
    });

    it('bypasses unsupported modalities (distance, timed, distance_loaded)', () => {
      const timed: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'timed',
        set: { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(timed)).toEqual({
        status: 'bypassed',
        bypassReason: 'unsupported_modality',
      });
    });
  });

  describe('Bodyweight Modality Evidence', () => {
    it('uses bodyweight snapshot when active set weight is 0', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'bodyweight',
        set: { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        targetUnit: 'kg',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.effectiveLoad).toBe(80);
        expect(result.reps).toBe(10);
        expect(result.rpe).toBe(8.0);
        // RTS: 10 reps @ 8.0 = 0.680 -> e1RM = 80 / 0.680 = 117.647...
        expect(result.e1RM).toBeCloseTo(80 / 0.680, 4);
      }
    });

    it('uses bodyweight snapshot when saved row weight equals bodyweight snapshot and does not double count', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'bodyweight',
        set: { setNumber: 1, weight: 80, reps: 10, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        targetUnit: 'kg',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        // Must strictly equal snapshot value (80 kg), never 80 + 80 = 160 kg
        expect(result.effectiveLoad).toBe(80);
        expect(result.e1RM).toBeCloseTo(80 / 0.680, 4);
      }
    });

    it('bypasses if bodyweight snapshot is missing or invalid', () => {
      const missingSnapshot: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'bodyweight',
        set: { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: null,
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(missingSnapshot)).toEqual({
        status: 'bypassed',
        bypassReason: 'missing_bodyweight_snapshot',
      });

      const invalidSnapshot: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'bodyweight',
        set: { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: -10, unit: 'kg' },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(invalidSnapshot)).toEqual({
        status: 'bypassed',
        bypassReason: 'invalid_bodyweight_snapshot',
      });
    });

    it('converts bodyweight snapshot unit accurately to targetUnit', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'bodyweight',
        set: { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 176.3698, unit: 'lb' },
        targetUnit: 'kg',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.effectiveLoad).toBeCloseTo(80.0, 3);
      }
    });
  });

  describe('Assisted Modality Evidence', () => {
    it('calculates effective load as bodyweight minus assistance', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'assisted',
        set: { setNumber: 1, weight: 50, reps: 8, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        targetUnit: 'kg',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.effectiveLoad).toBe(50); // 100 - 50 = 50 kg
        // RTS: 8 reps @ 8.0 = 0.728 -> e1RM = 50 / 0.728 = 68.6813...
        expect(result.e1RM).toBeCloseTo(50 / 0.728, 4);
      }
    });

    it('correctly extracts cross-unit assisted evidence (Test A: 100 kg snapshot, 110.23113109 lb assistance to kg target)', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'assisted',
        set: { setNumber: 1, weight: 110.23113109, reps: 8, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        sourceUnit: 'lb',
        targetUnit: 'kg',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.targetUnit).toBe('kg');
        // Converted assistance: 110.23113109 lb * 0.45359237 = 50.0000000003 kg
        // Effective load: 100 - 50 = ~50 kg (strictly not 100 - 110.23113109)
        expect(result.effectiveLoad).toBeCloseTo(50.0, 4);
        expect(result.reps).toBe(8);
        expect(result.rpe).toBe(8.0);
        // RTS for 8 reps @ 8.0 = 0.728 -> e1RM = 50 / 0.728 = 68.68131868...
        expect(result.e1RM).toBeCloseTo(50.0 / 0.728, 4);
        // Raw lb assistance was not subtracted from kg bodyweight:
        expect(result.effectiveLoad).not.toBeCloseTo(100 - 110.23113109, 1);
      }
    });

    it('correctly extracts cross-unit assisted evidence (Test B: 220.46226218 lb snapshot, 50 kg assistance to lb target)', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'assisted',
        set: { setNumber: 1, weight: 50, reps: 8, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 220.46226218, unit: 'lb' },
        sourceUnit: 'kg',
        targetUnit: 'lb',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.targetUnit).toBe('lb');
        // Converted assistance: 50 kg -> 110.23113109 lb
        // Effective load: 220.46226218 - 110.23113109 = 110.23113109 lb
        expect(result.effectiveLoad).toBeCloseTo(110.23113109, 4);
        expect(result.reps).toBe(8);
        expect(result.rpe).toBe(8.0);
        // RTS: 8 reps @ 8.0 = 0.728 -> e1RM = 110.23113109 / 0.728 = 151.4163888...
        expect(result.e1RM).toBeCloseTo(110.23113109 / 0.728, 4);
      }
    });

    it('accepts zero assistance as a valid effective load equal to bodyweight', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'assisted',
        set: { setNumber: 1, weight: 0, reps: 8, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        targetUnit: 'kg',
      };
      const result = extractSetPerformanceEvidence(input);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.effectiveLoad).toBe(100);
      }
    });

    it('rejects negative assistance', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'assisted',
        set: { setNumber: 1, weight: -5, reps: 8, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(input)).toEqual({
        status: 'bypassed',
        bypassReason: 'negative_assistance',
      });
    });

    it('rejects assistance equal to bodyweight', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'assisted',
        set: { setNumber: 1, weight: 100, reps: 8, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(input)).toEqual({
        status: 'bypassed',
        bypassReason: 'assistance_equals_or_exceeds_bodyweight',
      });
    });

    it('rejects assistance exceeding bodyweight', () => {
      const input: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'assisted',
        set: { setNumber: 1, weight: 120, reps: 8, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        targetUnit: 'kg',
      };
      expect(extractSetPerformanceEvidence(input)).toEqual({
        status: 'bypassed',
        bypassReason: 'assistance_equals_or_exceeds_bodyweight',
      });
    });
  });

  describe('Immutability and Determinism', () => {
    it('preserves input object immutability and yields deterministic identical results', () => {
      const originalInput: SetPerformanceEvidenceInput = {
        context: 'historical',
        modality: 'assisted',
        set: { setNumber: 1, weight: 45, reps: 10, rpe: 8.0, isCompleted: true },
        bodyweightSnapshot: { value: 90, unit: 'kg' },
        targetUnit: 'kg',
      };
      const inputCopy = JSON.parse(JSON.stringify(originalInput));

      const res1 = extractSetPerformanceEvidence(originalInput);
      const res2 = extractSetPerformanceEvidence(originalInput);

      expect(res1).toEqual(res2);
      expect(originalInput).toEqual(inputCopy);
    });
  });
});
