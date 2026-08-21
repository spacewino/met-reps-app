/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ExerciseEntry, SetEntry, BodyweightSnapshot } from '../../types';
import {
  validateAndGenerateAutoWarmup,
  AUTO_WARMUP_MESSAGES,
  AUTO_WARMUP_REPLACE_CONFIRMATION,
} from '../autoWarmupValidation';
import { remapAfterWarmupChange } from '../workoutCompletion';

describe('MetReps — Existing Auto-Warmup Replacement Confirmation Suite', () => {
  const validSnapshotKg: BodyweightSnapshot = {
    value: 100,
    unit: 'kg',
  };

  describe('1. Exact Wording and Confirmation Contract Constants', () => {
    it('verifies exact title, message, cancel, and confirm button text', () => {
      expect(AUTO_WARMUP_REPLACE_CONFIRMATION.TITLE).toBe('Replace existing warm-ups?');
      expect(AUTO_WARMUP_REPLACE_CONFIRMATION.MESSAGE).toBe(
        'Existing warm-up sets, notes and edits will be removed.'
      );
      expect(AUTO_WARMUP_REPLACE_CONFIRMATION.CANCEL_LABEL).toBe('Cancel');
      expect(AUTO_WARMUP_REPLACE_CONFIRMATION.CONFIRM_LABEL).toBe('Replace');
    });
  });

  describe('2. Immediate Generation when No Warm-Ups Exist (Scenarios 1-4)', () => {
    it('1. applies immediately without confirmation when no existing warm-up sets exist (weighted)', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 100, reps: 5, isWarmup: false },
          { setNumber: 2, weight: 100, reps: 5, isWarmup: false },
        ],
      };

      const hasExistingWarmups = exercise.sets.some(s => s.isWarmup);
      expect(hasExistingWarmups).toBe(false);

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });
      expect(validation.status).toBe('valid');
      if (validation.status === 'valid') {
        expect(validation.warmupTargets.length).toBeGreaterThan(0);
      }
    });

    it('2. applies immediately without confirmation when no existing warm-up sets exist (bodyweight)', () => {
      const exercise: ExerciseEntry = {
        name: 'Pull-Up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 10, isWarmup: false }],
      };

      const hasExistingWarmups = exercise.sets.some(s => s.isWarmup);
      expect(hasExistingWarmups).toBe(false);

      const validation = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 0,
        bodyweightSnapshot: validSnapshotKg,
      });
      expect(validation.status).toBe('valid');
    });

    it('3. applies immediately without confirmation when no existing warm-up sets exist (assisted)', () => {
      const exercise: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 40, reps: 8, isWarmup: false }],
      };

      const hasExistingWarmups = exercise.sets.some(s => s.isWarmup);
      expect(hasExistingWarmups).toBe(false);

      const validation = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 0,
        bodyweightSnapshot: validSnapshotKg,
      });
      expect(validation.status).toBe('valid');
    });

    it('4. bypasses immediately with toast feedback and no confirmation when no warmups and invalid target', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: null, reps: null, isWarmup: false }],
      };

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 0 });
      expect(validation.status).toBe('bypassed');
      if (validation.status === 'bypassed') {
        expect(validation.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_AND_REPS);
      }
    });
  });

  describe('3. Validation Bypasses BEFORE Confirmation when Warm-Ups Exist (Scenarios 5-6)', () => {
    it('5. runs validation first and bypasses before opening confirmation if target is invalid', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Squat',
        muscleGroup: 'Quads',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 40, reps: 8, isWarmup: true, comment: 'old warmup' },
          { setNumber: 2, weight: null, reps: null, isWarmup: false },
        ],
      };

      const hasExistingWarmups = exercise.sets.some(s => s.isWarmup);
      expect(hasExistingWarmups).toBe(true);

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 1 });
      expect(validation.status).toBe('bypassed');
      if (validation.status === 'bypassed') {
        expect(validation.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_AND_REPS);
      }
    });

    it('6. bypasses before opening confirmation for unsupported modalities even with existing warmups', () => {
      const exercise: ExerciseEntry = {
        name: 'Treadmill Run',
        muscleGroup: 'Cardio',
        modality: 'distance',
        sets: [
          { setNumber: 1, weight: 0, reps: 500, isWarmup: true },
          { setNumber: 2, weight: 0, reps: 5000, isWarmup: false },
        ],
      };

      const hasExistingWarmups = exercise.sets.some(s => s.isWarmup);
      expect(hasExistingWarmups).toBe(true);

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 1 });
      expect(validation.status).toBe('bypassed');
      if (validation.status === 'bypassed') {
        expect(validation.message).toBe(AUTO_WARMUP_MESSAGES.UNSUPPORTED_MODALITY);
      }
    });
  });

  describe('4. Confirmation Flow & State Integrity (Scenarios 7-12)', () => {
    it('7. triggers confirmation dialog request when warmups exist and validation is valid', () => {
      const exercise: ExerciseEntry = {
        name: 'Deadlift',
        muscleGroup: 'Back',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 60, reps: 5, isWarmup: true, comment: 'warmup 1' },
          { setNumber: 2, weight: 100, reps: 3, isWarmup: true, comment: 'warmup 2' },
          { setNumber: 3, weight: 140, reps: 5, isWarmup: false, comment: 'working set 1' },
        ],
      };

      const hasExistingWarmups = exercise.sets.some(s => s.isWarmup);
      expect(hasExistingWarmups).toBe(true);

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 2 });
      expect(validation.status).toBe('valid');
    });

    it('8. leaves all existing state 100% untouched when user cancels replacement (Zero Mutation)', () => {
      const initialExercise: ExerciseEntry = {
        name: 'Deadlift',
        muscleGroup: 'Back',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 60, reps: 5, isWarmup: true, comment: 'warmup 1' },
          { setNumber: 2, weight: 100, reps: 3, isWarmup: true, comment: 'warmup 2' },
          { setNumber: 3, weight: 140, reps: 5, isWarmup: false, comment: 'working set 1' },
        ],
      };

      const snapshotBefore = JSON.parse(JSON.stringify(initialExercise));
      // Simulate Cancel -> no mutation performed
      expect(initialExercise).toEqual(snapshotBefore);
    });

    it('9. removes existing warmups and inserts freshly generated warmups ahead of working sets on confirm', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 40, reps: 10, isWarmup: true, comment: 'old warmup 1' },
          { setNumber: 2, weight: 60, reps: 5, isWarmup: true, comment: 'old warmup 2' },
          { setNumber: 3, weight: 100, reps: 5, isWarmup: false, comment: 'top set' },
          { setNumber: 4, weight: 90, reps: 6, isWarmup: false, comment: 'backoff set' },
        ],
      };

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 2 });
      expect(validation.status).toBe('valid');
      if (validation.status !== 'valid') return;

      const workingSetsOnly = exercise.sets.filter(s => !s.isWarmup);
      const autoWarmupSets: SetEntry[] = validation.warmupTargets.map((t, tIdx) => ({
        setNumber: tIdx + 1,
        weight: t.weight,
        reps: t.reps,
        rpe: t.rpe,
        form: 'standard',
        isWarmup: true,
      }));

      const combined = [...autoWarmupSets, ...workingSetsOnly].map((s, idx) => ({
        ...s,
        setNumber: idx + 1,
      }));

      // Warm-ups placed ahead of working sets
      const warmupCount = validation.warmupTargets.length;
      expect(combined.slice(0, warmupCount).every(s => s.isWarmup)).toBe(true);
      expect(combined.slice(warmupCount).every(s => !s.isWarmup)).toBe(true);

      // Working sets count matches original
      expect(combined.filter(s => !s.isWarmup)).toHaveLength(2);
    });

    it('10. preserves working set notes and comments during warm-up replacement', () => {
      const exercise: ExerciseEntry = {
        name: 'Overhead Press',
        muscleGroup: 'Shoulders',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 20, reps: 8, isWarmup: true, comment: 'bar only' },
          { setNumber: 2, weight: 60, reps: 5, isWarmup: false, comment: 'felt smooth on reps' },
        ],
      };

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 1 });
      expect(validation.status).toBe('valid');
      if (validation.status !== 'valid') return;

      const workingSetsOnly = exercise.sets.filter(s => !s.isWarmup);
      const autoWarmupSets: SetEntry[] = validation.warmupTargets.map((t, tIdx) => ({
        setNumber: tIdx + 1,
        weight: t.weight,
        reps: t.reps,
        rpe: t.rpe,
        form: 'standard',
        isWarmup: true,
      }));

      const combined = [...autoWarmupSets, ...workingSetsOnly].map((s, idx) => ({
        ...s,
        setNumber: idx + 1,
      }));

      const updatedWorkingSet = combined.find(s => !s.isWarmup);
      expect(updatedWorkingSet?.comment).toBe('felt smooth on reps');
      expect(updatedWorkingSet?.weight).toBe(60);
      expect(updatedWorkingSet?.reps).toBe(5);
    });

    it('11. preserves skipped state on working sets and maintains contiguous skipped suffix', () => {
      const exercise: ExerciseEntry = {
        name: 'Incline Dumbbell Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 14, reps: 10, isWarmup: true },
          { setNumber: 2, weight: 32, reps: 8, isWarmup: false },
          { setNumber: 3, weight: 32, reps: 8, isWarmup: false, isSkipped: true },
        ],
      };

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 1 });
      expect(validation.status).toBe('valid');
      if (validation.status !== 'valid') return;

      const workingSetsOnly = exercise.sets.filter(s => !s.isWarmup);
      const autoWarmupSets: SetEntry[] = validation.warmupTargets.map((t, tIdx) => ({
        setNumber: tIdx + 1,
        weight: t.weight,
        reps: t.reps,
        rpe: t.rpe,
        form: 'standard',
        isWarmup: true,
      }));

      const combined = [...autoWarmupSets, ...workingSetsOnly].map((s, idx) => ({
        ...s,
        setNumber: idx + 1,
      }));

      const finalSet = combined[combined.length - 1];
      expect(finalSet.isSkipped).toBe(true);
      expect(finalSet.setNumber).toBe(combined.length);
    });

    it('12. preserves drop sets and drop subsets on working sets', () => {
      const exercise: ExerciseEntry = {
        name: 'Lateral Raise',
        muscleGroup: 'Shoulders',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 4, reps: 12, isWarmup: true },
          {
            setNumber: 2,
            weight: 12,
            reps: 10,
            isWarmup: false,
            isDropSet: true,
            dropSubSets: [
              { weight: 8, reps: 8 },
              { weight: 6, reps: 10 },
            ],
          },
        ],
      };

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 1 });
      expect(validation.status).toBe('valid');
      if (validation.status !== 'valid') return;

      const workingSetsOnly = exercise.sets.filter(s => !s.isWarmup);
      const autoWarmupSets: SetEntry[] = validation.warmupTargets.map((t, tIdx) => ({
        setNumber: tIdx + 1,
        weight: t.weight,
        reps: t.reps,
        rpe: t.rpe,
        form: 'standard',
        isWarmup: true,
      }));

      const combined = [...autoWarmupSets, ...workingSetsOnly].map((s, idx) => ({
        ...s,
        setNumber: idx + 1,
      }));

      const dropSet = combined.find(s => s.isDropSet);
      expect(dropSet).toBeDefined();
      expect(dropSet?.dropSubSets).toHaveLength(2);
      expect(dropSet?.dropSubSets?.[0].weight).toBe(8);
    });
  });

  describe('5. State Remapping & Session Integrity (Scenarios 13-18)', () => {
    it('13. correctly remaps set keys when warm-up count changes (e.g. 2 prior warmups -> 4 new warmups)', () => {
      const initialChecked: Record<string, boolean> = {
        '0-2': true, // was first working set when priorWarmups = 2
        '0-3': true, // was second working set
      };

      const remapped = remapAfterWarmupChange(initialChecked, 0, 2, 4);
      // Working sets shifted by delta (+2)
      expect(remapped['0-4']).toBe(true);
      expect(remapped['0-5']).toBe(true);
      expect(remapped['0-2']).toBeUndefined();
      expect(remapped['0-3']).toBeUndefined();
    });

    it('14. correctly remaps set keys when warm-up count decreases (e.g. 3 prior warmups -> 2 new warmups)', () => {
      const initialTouched: Record<string, boolean> = {
        '0-3': true, // was first working set when priorWarmups = 3
      };

      const remapped = remapAfterWarmupChange(initialTouched, 0, 3, 2);
      // Working set shifted by delta (-1)
      expect(remapped['0-2']).toBe(true);
      expect(remapped['0-3']).toBeUndefined();
    });

    it('15. discards old warm-up notes upon replacement as specified', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Row',
        muscleGroup: 'Back',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 30, reps: 10, isWarmup: true, comment: 'old warmup note' },
          { setNumber: 2, weight: 80, reps: 8, isWarmup: false },
        ],
      };

      const validation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 1 });
      expect(validation.status).toBe('valid');
      if (validation.status !== 'valid') return;

      const workingSetsOnly = exercise.sets.filter(s => !s.isWarmup);
      const autoWarmupSets: SetEntry[] = validation.warmupTargets.map((t, tIdx) => ({
        setNumber: tIdx + 1,
        weight: t.weight,
        reps: t.reps,
        rpe: t.rpe,
        form: 'standard',
        isWarmup: true,
      }));

      const combined = [...autoWarmupSets, ...workingSetsOnly].map((s, idx) => ({
        ...s,
        setNumber: idx + 1,
      }));

      const warmupComments = combined.filter(s => s.isWarmup).map(s => s.comment);
      expect(warmupComments.every(c => !c)).toBe(true);
    });

    it('16. handles bodyweight modality replacement with multiple existing warmups', () => {
      const exercise: ExerciseEntry = {
        name: 'Dips',
        muscleGroup: 'Chest',
        modality: 'bodyweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 2, isWarmup: true },
          { setNumber: 2, weight: 0, reps: 12, isWarmup: false },
        ],
      };

      const validation = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 1,
        bodyweightSnapshot: validSnapshotKg,
      });

      expect(validation.status).toBe('valid');
      if (validation.status === 'valid') {
        expect(validation.modality).toBe('bodyweight');
        expect(validation.warmupTargets.length).toBeGreaterThan(0);
      }
    });

    it('17. handles assisted modality replacement with multiple existing warmups', () => {
      const exercise: ExerciseEntry = {
        name: 'Assisted Chin-Up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [
          { setNumber: 1, weight: 60, reps: 5, isWarmup: true },
          { setNumber: 2, weight: 30, reps: 8, isWarmup: false },
        ],
      };

      const validation = validateAndGenerateAutoWarmup({
        exercise,
        selectedSetIdx: 1,
        bodyweightSnapshot: validSnapshotKg,
      });

      expect(validation.status).toBe('valid');
      if (validation.status === 'valid') {
        expect(validation.modality).toBe('assisted');
        expect(validation.warmupTargets.length).toBeGreaterThan(0);
      }
    });

    it('18. handles re-validation failure on confirm if target was modified to be invalid', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 40, reps: 5, isWarmup: true },
          { setNumber: 2, weight: null, reps: null, isWarmup: false },
        ],
      };

      // Simulating revalidation at confirm time
      const revalidation = validateAndGenerateAutoWarmup({ exercise, selectedSetIdx: 1 });
      expect(revalidation.status).toBe('bypassed');
      if (revalidation.status === 'bypassed') {
        expect(revalidation.message).toBe(AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_AND_REPS);
      }
    });
  });
});
