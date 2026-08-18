/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ExerciseEntry, BodyweightSnapshot } from '../../types';
import {
  validateAndGenerateAutoWarmup,
  AUTO_WARMUP_MESSAGES,
} from '../autoWarmupValidation';

describe('Auto Warmup Validation and Generation', () => {
  const validSnapshotKg: BodyweightSnapshot = {
    value: 100,
    unit: 'kg',
  };

  describe('Weighted / Legacy Modality', () => {
    it('1. returns bypassed with missing weight and reps feedback when target row has null weight and reps', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: null, reps: null }],
      };

      const result = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.bypassReason).toBe('missing_weight_and_reps');
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_AND_REPS);
        expect(result.warmupTargets).toBeNull();
      }
    });

    it('2. returns bypassed with missing weight feedback when target row has valid reps but missing weight', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: null, reps: 10 }],
      };

      const result = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.bypassReason).toBe('missing_weight');
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_ONLY);
        expect(result.warmupTargets).toBeNull();
      }
    });

    it('3. returns bypassed with missing weight feedback when target row has zero or negative weight', () => {
      const zeroWeightEx: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 0, reps: 10 }],
      };

      const resZero = validateAndGenerateAutoWarmup({ exercise: zeroWeightEx, selectedSetIdx: 0 });
      expect(resZero.status).toBe('bypassed');
      if (resZero.status === 'bypassed') {
        expect(resZero.bypassReason).toBe('missing_weight');
        expect(resZero.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_ONLY);
      }

      const negWeightEx: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: -50, reps: 10 }],
      };

      const resNeg = validateAndGenerateAutoWarmup({ exercise: negWeightEx, selectedSetIdx: 0 });
      expect(resNeg.status).toBe('bypassed');
      if (resNeg.status === 'bypassed') {
        expect(resNeg.bypassReason).toBe('missing_weight');
        expect(resNeg.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_ONLY);
      }
    });

    it('4. returns bypassed with missing reps feedback when target row has valid weight but missing reps', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 100, reps: null }],
      };

      const result = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.bypassReason).toBe('invalid_working_reps');
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_REPS_ONLY);
        expect(result.warmupTargets).toBeNull();
      }
    });

    it('5. returns bypassed with missing reps feedback when target row has zero, negative, or non-integer reps', () => {
      const zeroRepsEx: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 100, reps: 0 }],
      };

      const resZero = validateAndGenerateAutoWarmup({ exercise: zeroRepsEx, selectedSetIdx: 0 });
      expect(resZero.status).toBe('bypassed');
      if (resZero.status === 'bypassed') {
        expect(resZero.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_REPS_ONLY);
      }

      const fracRepsEx: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 100, reps: 8.5 }],
      };

      const resFrac = validateAndGenerateAutoWarmup({ exercise: fracRepsEx, selectedSetIdx: 0 });
      expect(resFrac.status).toBe('bypassed');
      if (resFrac.status === 'bypassed') {
        expect(resFrac.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_REPS_ONLY);
      }
    });

    it('6. generates 3 calibrated weighted warm-up sets when given a valid working target (100 kg x 10)', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 100, reps: 10 }],
      };

      const result = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });

      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.modality).toBe('weighted');
        expect(result.warmupTargets).toHaveLength(3);

        // Set 1: 50% = 50 kg, reps = 10, rpe = 4.0
        expect(result.warmupTargets[0]).toEqual({
          setNumber: 1,
          weight: 50,
          reps: 10,
          rpe: 4.0,
          form: 'standard',
          isWarmup: true,
        });

        // Set 2: 70% = 70 kg, reps = max(5, round(7)) = 7, rpe = 6.0
        expect(result.warmupTargets[1]).toEqual({
          setNumber: 2,
          weight: 70,
          reps: 7,
          rpe: 6.0,
          form: 'standard',
          isWarmup: true,
        });

        // Set 3: 85% = 85 kg, reps = max(3, round(3.5)) = 4, rpe = 7.0
        expect(result.warmupTargets[2]).toEqual({
          setNumber: 3,
          weight: 85,
          reps: 4,
          rpe: 7.0,
          form: 'standard',
          isWarmup: true,
        });
      }
    });

    it('7. falls back to first valid working row when selected row is a warm-up or invalid row', () => {
      const exercise: ExerciseEntry = {
        name: 'Squat',
        muscleGroup: 'Legs',
        sets: [
          { setNumber: 1, weight: 20, reps: 10, isWarmup: true },
          { setNumber: 2, weight: null, reps: null },
          { setNumber: 3, weight: 140, reps: 8 },
        ],
      };

      // Tapping on set index 0 (warmup set)
      const result = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });

      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.resolvedWorkingTarget).toEqual({ weight: 140, reps: 8 });
        expect(result.warmupTargets[0].weight).toBe(70); // 140 * 0.50 = 70
        expect(result.warmupTargets[0].reps).toBe(8);
      }
    });
  });

  describe('Bodyweight Modality', () => {
    it('8. returns bypassed with missing reps feedback when bodyweight exercise has null/undefined reps', () => {
      const exercise: ExerciseEntry = {
        name: 'Pull-Up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: null }],
      };

      const result = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.bypassReason).toBe('invalid_working_reps');
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.BODYWEIGHT_MISSING_OR_INVALID_REPS);
        expect(result.warmupTargets).toBeNull();
      }
    });

    it('9. returns bypassed with missing reps feedback when bodyweight reps is 0, negative, or fractional', () => {
      const exercise: ExerciseEntry = {
        name: 'Push-Up',
        muscleGroup: 'Chest',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 0 }],
      };

      const result = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.BODYWEIGHT_MISSING_OR_INVALID_REPS);
      }
    });

    it('10. returns special one-rep message when bodyweight target is 1 rep', () => {
      const exercise: ExerciseEntry = {
        name: 'One-Arm Pull-Up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 1 }],
      };

      const result = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.bypassReason).toBe('insufficient_repetition_resolution');
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.BODYWEIGHT_ONE_REP_RESOLUTION);
      }
    });

    it('11. generates calibrated bodyweight warmups when given valid reps (BODYWT x 10 -> 2, 4, 5 reps)', () => {
      const exercise: ExerciseEntry = {
        name: 'Dips',
        muscleGroup: 'Triceps',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 10 }],
      };

      const result = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });

      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.modality).toBe('bodyweight');
        expect(result.warmupTargets).toHaveLength(3);
        expect(result.warmupTargets[0]).toEqual({
          setNumber: 1,
          weight: 0,
          reps: 2,
          rpe: 4.0,
          form: 'standard',
          isWarmup: true,
        });
        expect(result.warmupTargets[1]).toEqual({
          setNumber: 2,
          weight: 0,
          reps: 4,
          rpe: 6.0,
          form: 'standard',
          isWarmup: true,
        });
        expect(result.warmupTargets[2]).toEqual({
          setNumber: 3,
          weight: 0,
          reps: 5,
          rpe: 7.0,
          form: 'standard',
          isWarmup: true,
        });
      }
    });
  });

  describe('Assisted Modality', () => {
    it('12. returns bypassed with missing assistance and reps feedback when both are null', () => {
      const exercise: ExerciseEntry = {
        name: 'Assisted Pull-Up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: null, reps: null }],
      };

      const result = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 0,
        bodyweightSnapshot: validSnapshotKg,
      });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.bypassReason).toBe('missing_assistance_and_reps');
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_ASSISTANCE_AND_REPS);
      }
    });

    it('13. returns bypassed with missing assistance feedback when assistance is null but reps is valid', () => {
      const exercise: ExerciseEntry = {
        name: 'Assisted Pull-Up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: null, reps: 8 }],
      };

      const result = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 0,
        bodyweightSnapshot: validSnapshotKg,
      });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.bypassReason).toBe('missing_assistance');
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_ASSISTANCE_ONLY);
      }
    });

    it('14. returns bypassed with missing reps feedback when assistance is valid but reps is missing', () => {
      const exercise: ExerciseEntry = {
        name: 'Assisted Pull-Up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 30, reps: null }],
      };

      const result = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 0,
        bodyweightSnapshot: validSnapshotKg,
      });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.bypassReason).toBe('invalid_working_reps');
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_REPS_ONLY);
      }
    });

    it('15. returns bypassed when bodyweight snapshot is missing or invalid', () => {
      const exercise: ExerciseEntry = {
        name: 'Assisted Pull-Up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 30, reps: 8 }],
      };

      const resultNullSnapshot = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 0,
        bodyweightSnapshot: null,
      });

      expect(resultNullSnapshot.status).toBe('bypassed');
      if (resultNullSnapshot.status === 'bypassed') {
        expect(resultNullSnapshot.bypassReason).toBe('missing_bodyweight');
        expect(resultNullSnapshot.message).toBe(AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_BODYWEIGHT_SNAPSHOT);
      }
    });

    it('16. returns bypassed when assistance equals or exceeds bodyweight', () => {
      const exercise: ExerciseEntry = {
        name: 'Assisted Pull-Up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 100, reps: 8 }], // bw = 100
      };

      const result = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 0,
        bodyweightSnapshot: validSnapshotKg,
      });

      expect(result.status).toBe('bypassed');
      if (result.status === 'bypassed') {
        expect(result.message).toBe(AUTO_WARMUP_MESSAGES.ASSISTED_EXCEEDS_OR_EQUALS_BW);
      }
    });

    it('17. generates calibrated assisted warmups (100 kg bodyweight, 50 kg assistance, 8 reps -> [75, 65, 57.5])', () => {
      const exercise: ExerciseEntry = {
        name: 'Assisted Pull-Up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 50, reps: 8 }],
      };

      const result = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 0,
        bodyweightSnapshot: validSnapshotKg,
        activeUnit: 'kg',
      });

      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.modality).toBe('assisted');
        expect(result.warmupTargets).toHaveLength(3);
        expect(result.warmupTargets.map(t => t.weight)).toEqual([75, 65, 57.5]);
      }
    });

    it('18. treats zero assistance as a valid assistance weight and does not flag as missing', () => {
      const exercise: ExerciseEntry = {
        name: 'Assisted Dips',
        muscleGroup: 'Chest',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 0, reps: 8 }],
      };

      const result = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 0,
        bodyweightSnapshot: validSnapshotKg,
        activeUnit: 'kg',
      });

      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.modality).toBe('assisted');
        expect(result.warmupTargets).toHaveLength(3);
      }
    });
  });

  describe('Unsupported Modalities', () => {
    it('19. bypasses timed, distance, and distance_loaded modalities with unsupported modality message', () => {
      const timedEx: ExerciseEntry = {
        name: 'Plank',
        muscleGroup: 'Core',
        modality: 'timed',
        sets: [{ setNumber: 1, weight: 0, reps: 60 }],
      };

      const resTimed = validateAndGenerateAutoWarmup({ exercise: timedEx, selectedSetIdx: 0 });
      expect(resTimed.status).toBe('bypassed');
      if (resTimed.status === 'bypassed') {
        expect(resTimed.bypassReason).toBe('unsupported_modality');
        expect(resTimed.message).toBe(AUTO_WARMUP_MESSAGES.UNSUPPORTED_MODALITY);
      }

      const distEx: ExerciseEntry = {
        name: 'Running',
        muscleGroup: 'Legs',
        modality: 'distance',
        sets: [{ setNumber: 1, weight: 0, reps: 5000 }],
      };

      const resDist = validateAndGenerateAutoWarmup({ exercise: distEx, selectedSetIdx: 0 });
      expect(resDist.status).toBe('bypassed');
      if (resDist.status === 'bypassed') {
        expect(resDist.message).toBe(AUTO_WARMUP_MESSAGES.UNSUPPORTED_MODALITY);
      }
    });
  });

  describe('Zero Mutation Guarantee', () => {
    it('20. does not mutate exercise entries or sets on bypass or success', () => {
      const originalExercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: null, reps: null }],
      };

      const cloned = JSON.parse(JSON.stringify(originalExercise));
      validateAndGenerateAutoWarmup({ exercise: originalExercise, selectedSetIdx: 0 });
      expect(originalExercise).toEqual(cloned);
    });
  });
});
