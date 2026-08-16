import { describe, it, expect } from 'vitest';
import { ExerciseEntry, Program } from '../../types';
import {
  isEligibleStrengthMainMovement,
  getEligibleMainMovementCount,
  updateProgramDayMainMovement,
} from '../programMetadata';

describe('programMetadata - Main Movement Eligibility & Pure Metadata Persistence', () => {
  const samplePristineExercise1: ExerciseEntry = {
    name: 'Back Squat',
    muscleGroup: 'Quads',
    modality: 'weighted',
    isMainMovement: false,
    sets: [
      { setNumber: 1, weight: 100, reps: 8, rpe: 8, form: 'strict', comment: 'Pristine note 1', isWarmup: false, isDropSet: false },
      { setNumber: 2, weight: 100, reps: 8, rpe: 8, form: 'strict', comment: 'Pristine note 2', isWarmup: false, isDropSet: false },
      { setNumber: 3, weight: 100, reps: 8, rpe: 8, form: 'strict', comment: 'Pristine note 3', isWarmup: false, isDropSet: false },
    ],
  };

  const samplePristineExercise2: ExerciseEntry = {
    name: 'Leg Press',
    muscleGroup: 'Quads',
    modality: 'weighted',
    isMainMovement: false,
    sets: [
      { setNumber: 1, weight: 150, reps: 10, rpe: 8, form: 'standard', comment: 'Leg press note' },
      { setNumber: 2, weight: 150, reps: 10, rpe: 8, form: 'standard' },
    ],
  };

  const sampleProgram: Program = {
    id: 'test-prog-1',
    name: 'Strength Program Test',
    daysPerWeek: 3,
    programDuration: 8,
    createdAt: '2026-01-01T00:00:00.000Z',
    assignedWeekdays: { 1: 1, 2: 3, 3: 5 },
    objective: 'Strength',
    algorithmId: 'strength_undulating',
    exercisesByDay: {
      1: [samplePristineExercise1, samplePristineExercise2],
      2: [
        {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 80, reps: 8, rpe: 8 }],
        },
      ],
    },
  };

  describe('isEligibleStrengthMainMovement', () => {
    it('returns true for weighted exercises', () => {
      expect(isEligibleStrengthMainMovement({ name: 'Squat', muscleGroup: 'Quads', sets: [], modality: 'weighted' })).toBe(true);
    });

    it('returns true for undefined modality (defaults to weighted)', () => {
      expect(isEligibleStrengthMainMovement({ name: 'Squat', muscleGroup: 'Quads', sets: [] })).toBe(true);
    });

    it('returns false for skipped exercises regardless of modality', () => {
      expect(isEligibleStrengthMainMovement({ name: 'Squat', muscleGroup: 'Quads', sets: [], modality: 'weighted', isSkipped: true })).toBe(false);
      expect(isEligibleStrengthMainMovement({ name: 'Squat', muscleGroup: 'Quads', sets: [], isSkipped: true })).toBe(false);
    });

    it('returns false for non-weighted modalities', () => {
      expect(isEligibleStrengthMainMovement({ name: 'Pullup', muscleGroup: 'Back', sets: [], modality: 'bodyweight' })).toBe(false);
      expect(isEligibleStrengthMainMovement({ name: 'Dips', muscleGroup: 'Triceps', sets: [], modality: 'assisted' })).toBe(false);
      expect(isEligibleStrengthMainMovement({ name: 'Plank', muscleGroup: 'Core', sets: [], modality: 'timed' })).toBe(false);
      expect(isEligibleStrengthMainMovement({ name: 'Run', muscleGroup: 'Cardio', sets: [], modality: 'distance' })).toBe(false);
      expect(isEligibleStrengthMainMovement({ name: 'Farmer Walk', muscleGroup: 'Full Body', sets: [], modality: 'distance_loaded' })).toBe(false);
    });
  });

  describe('getEligibleMainMovementCount', () => {
    it('returns 0 when no exercises have isMainMovement', () => {
      expect(getEligibleMainMovementCount([samplePristineExercise1, samplePristineExercise2])).toBe(0);
    });

    it('returns 1 when one weighted exercise has isMainMovement: true', () => {
      const exList: ExerciseEntry[] = [
        { ...samplePristineExercise1, isMainMovement: true },
        samplePristineExercise2,
      ];
      expect(getEligibleMainMovementCount(exList)).toBe(1);
    });

    it('returns 0 if the only isMainMovement exercise is skipped or non-weighted', () => {
      const exList: ExerciseEntry[] = [
        { ...samplePristineExercise1, isMainMovement: true, isSkipped: true },
        samplePristineExercise2,
      ];
      expect(getEligibleMainMovementCount(exList)).toBe(0);

      const bwList: ExerciseEntry[] = [
        { ...samplePristineExercise1, isMainMovement: true, modality: 'bodyweight' },
        samplePristineExercise2,
      ];
      expect(getEligibleMainMovementCount(bwList)).toBe(0);
    });

    it('returns >1 if multiple eligible exercises have isMainMovement: true (corrupted state)', () => {
      const exList: ExerciseEntry[] = [
        { ...samplePristineExercise1, isMainMovement: true },
        { ...samplePristineExercise2, isMainMovement: true },
      ];
      expect(getEligibleMainMovementCount(exList)).toBe(2);
    });
  });

  describe('updateProgramDayMainMovement', () => {
    it('persists isMainMovement: true to exactly the targeted exercise while keeping all template sets pristine', () => {
      const res = updateProgramDayMainMovement(sampleProgram, 1, 0, 'Back Squat');
      expect(res.success).toBe(true);
      expect(res.error).toBeUndefined();

      const day1 = res.updatedProgram.exercisesByDay[1];
      expect(day1[0].isMainMovement).toBe(true);
      expect(day1[1].isMainMovement).toBe(false);

      // Verify that all pristine template sets, weights, reps, and comments are preserved verbatim
      expect(day1[0].sets).toEqual(samplePristineExercise1.sets);
      expect(day1[0].sets[0].weight).toBe(100);
      expect(day1[0].sets[0].reps).toBe(8);
      expect(day1[0].sets[0].rpe).toBe(8);
      expect(day1[0].sets[0].comment).toBe('Pristine note 1');

      expect(day1[1].sets).toEqual(samplePristineExercise2.sets);

      // Day 2 remains untouched
      expect(res.updatedProgram.exercisesByDay[2]).toEqual(sampleProgram.exercisesByDay[2]);
    });

    it('clears all main movements on a day when targetIdx is null', () => {
      const programWithMain: Program = {
        ...sampleProgram,
        exercisesByDay: {
          ...sampleProgram.exercisesByDay,
          1: [
            { ...samplePristineExercise1, isMainMovement: true },
            samplePristineExercise2,
          ],
        },
      };

      const res = updateProgramDayMainMovement(programWithMain, 1, null);
      expect(res.success).toBe(true);
      const day1 = res.updatedProgram.exercisesByDay[1];
      expect(day1[0].isMainMovement).toBe(false);
      expect(day1[1].isMainMovement).toBe(false);
      expect(day1[0].sets).toEqual(samplePristineExercise1.sets);
    });

    it('correctly handles swap: setting Exercise 1 (Leg Press) as main sets Exercise 0 (Back Squat) to false', () => {
      const programWithSquatMain: Program = {
        ...sampleProgram,
        exercisesByDay: {
          ...sampleProgram.exercisesByDay,
          1: [
            { ...samplePristineExercise1, isMainMovement: true },
            samplePristineExercise2,
          ],
        },
      };

      const res = updateProgramDayMainMovement(programWithSquatMain, 1, 1, 'Leg Press');
      expect(res.success).toBe(true);
      const day1 = res.updatedProgram.exercisesByDay[1];
      expect(day1[0].isMainMovement).toBe(false);
      expect(day1[1].isMainMovement).toBe(true);
      expect(day1[0].sets).toEqual(samplePristineExercise1.sets);
      expect(day1[1].sets).toEqual(samplePristineExercise2.sets);
    });

    it('falls back to unique normalized-name match when array index has shifted', () => {
      // Suppose active session or reordering had Leg Press at index 0 and Back Squat at index 1
      // but in the stored template Back Squat is at index 0.
      const res = updateProgramDayMainMovement(sampleProgram, 1, 1, 'Back Squat');
      expect(res.success).toBe(true);
      const day1 = res.updatedProgram.exercisesByDay[1];
      expect(day1[0].name).toBe('Back Squat');
      expect(day1[0].isMainMovement).toBe(true);
      expect(day1[1].isMainMovement).toBe(false);
    });

    it('fails safely and makes no changes if exercise name is not found in template', () => {
      const res = updateProgramDayMainMovement(sampleProgram, 1, 0, 'Nonexistent Exercise');
      expect(res.success).toBe(false);
      expect(res.error).toContain('could not be found');
      expect(res.updatedProgram).toBe(sampleProgram);
    });

    it('fails safely without modifying storage if duplicate names exist on the same day and cannot be resolved', () => {
      const duplicateProgram: Program = {
        ...sampleProgram,
        exercisesByDay: {
          1: [
            { ...samplePristineExercise1, name: 'Back Squat' },
            { ...samplePristineExercise2, name: 'Back Squat' },
          ],
        },
      };

      // Provided targetIdx 5 is out of bounds, so it attempts name search which finds 2 matches
      const res = updateProgramDayMainMovement(duplicateProgram, 1, 5, 'Back Squat');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Multiple exercises named');
      expect(res.updatedProgram).toBe(duplicateProgram);
    });

    it('fails safely if day does not exist in program', () => {
      const res = updateProgramDayMainMovement(sampleProgram, 99, 0, 'Back Squat');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Program day 99 not found');
    });
  });
});
