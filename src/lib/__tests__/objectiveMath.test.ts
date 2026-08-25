import { describe, it, expect } from 'vitest';
import {
  extractHistoricalBaselineE1RM,
  extractTemplateBaselineE1RM,
  calculateObjectiveSets,
  roundToNearest25,
  getRTSMultiplier,
} from '../objectiveMath';
import { WorkoutLog, ExerciseEntry } from '../../types';

describe('objectiveMath - Phase 2A-3 Multi-Set Distribution Integration', () => {
  // Common test fixture: 100 kg x 10 @ 8.0 => e1RM = 100 / 0.680 = 147.0588 kg
  const sampleHistoricalLogs: WorkoutLog[] = [
    {
      id: 'hist-log-1',
      date: '2026-01-01',
      unit: 'kg',
      objective: 'Strength',
      exercises: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false }],
        },
      ],
    },
  ];

  describe('1. Baseline Precedence & Extraction Tests', () => {
    it('returns 0 when logs array is empty or undefined', () => {
      expect(extractHistoricalBaselineE1RM('Bench Press', [])).toBe(0);
      expect(extractHistoricalBaselineE1RM('Bench Press', null as any)).toBe(0);
    });

    it('matches exercise names case-insensitively with trimming', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: '  Barbell Bench Press  ',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 100, reps: 5, rpe: 8.0 }],
            },
          ],
        },
      ];
      const e1rm = extractHistoricalBaselineE1RM('barbell bench press', logs);
      expect(e1rm).toBeCloseTo(100 / 0.807, 2);
    });

    it('ignores skipped exercises in historical baseline extraction', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Legs',
              isSkipped: true,
              sets: [{ setNumber: 1, weight: 200, reps: 5, rpe: 8.0 }],
            },
          ],
        },
      ];
      expect(extractHistoricalBaselineE1RM('Squat', logs)).toBe(0);
    });

    it('ignores warm-up sets completely (isWarmup === true)', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Deadlift',
              muscleGroup: 'Back',
              sets: [
                { setNumber: 1, weight: 140, reps: 5, rpe: 8.0, isWarmup: true },
                { setNumber: 2, weight: 180, reps: 5, rpe: 8.0, isWarmup: true },
              ],
            },
          ],
        },
      ];
      expect(extractHistoricalBaselineE1RM('Deadlift', logs)).toBe(0);
    });

    it('ignores invalid weights, reps, and explicitly invalid RPE (< 6 or > 10)', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Overhead Press',
              muscleGroup: 'Shoulders',
              sets: [
                { setNumber: 1, weight: 0, reps: 5, rpe: 8.0 },
                { setNumber: 2, weight: -50, reps: 5, rpe: 8.0 },
                { setNumber: 3, weight: 60, reps: 0, rpe: 8.0 },
                { setNumber: 4, weight: 60, reps: 5, rpe: 4.0 },
                { setNumber: 5, weight: 60, reps: 5, rpe: 11.0 },
              ],
            },
          ],
        },
      ];
      expect(extractHistoricalBaselineE1RM('Overhead Press', logs)).toBe(0);
    });

    it('tier 1: selects the maximum e1RM among valid RPE sets', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Legs',
              sets: [
                { setNumber: 1, weight: 100, reps: 5, rpe: 8.0 },
                { setNumber: 2, weight: 110, reps: 5, rpe: 8.0 },
                { setNumber: 3, weight: 120, reps: 3, rpe: 9.0 },
              ],
            },
          ],
        },
      ];
      const e1rm = extractHistoricalBaselineE1RM('Squat', logs);
      expect(e1rm).toBeCloseTo(110 / 0.807, 2);
    });

    it('tier 2: falls back to missing-RPE sets via pure Reps Epley when no valid RPE sets exist', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Barbell Row',
              muscleGroup: 'Back',
              sets: [
                { setNumber: 1, weight: 100, reps: 10, rpe: null },
                { setNumber: 2, weight: 90, reps: 12, rpe: 0 },
              ],
            },
          ],
        },
      ];
      const e1rm = extractHistoricalBaselineE1RM('Barbell Row', logs);
      expect(e1rm).toBeCloseTo(100 * (1 + 10 / 30), 2);
    });

    it('extractTemplateBaselineE1RM extracts template baseline correctly', () => {
      const templateEx: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, isWarmup: true },
          { setNumber: 2, weight: 100, reps: 8, rpe: 8.0, isWarmup: false },
        ],
      };
      const e1rm = extractTemplateBaselineE1RM(templateEx);
      expect(e1rm).toBeCloseTo(100 / 0.728, 2);
    });

    it('re-exported roundToNearest25 maintains exact rounding behavior', () => {
      expect(roundToNearest25(101.24)).toBe(100.0);
      expect(roundToNearest25(101.25)).toBe(102.5);
      expect(roundToNearest25(114.559)).toBe(115.0);
      expect(roundToNearest25(113.216)).toBe(112.5);
    });
  });

  describe('2. Algorithm Compatibility & Policy B Resolution', () => {
    const baseEx: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      isMainMovement: true,
      movementCategory: 'compound',
      equipment: 'freeweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
        { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
        { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
      ],
    };

    it('Hypertrophy with algorithmId: "none" resolves to hypertrophy_linear and generates distributed targets', () => {
      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'none',
      });
      // Week 1 odd week compound fw -> 12 reps @ 8.0 -> 90.0 kg Set 1
      expect(result[0].reps).toBe(12);
      expect(result[0].rpe).toBe(8.0);
      expect(result[0].weight).toBe(90.0);
      // Set 2: 90.0 kg x 12 reps @ 8.5
      expect(result[1].reps).toBe(12);
      expect(result[1].rpe).toBe(8.5);
      expect(result[1].weight).toBe(90.0);
    });

    it('Hypertrophy with algorithmId: undefined resolves to hypertrophy_linear', () => {
      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: undefined,
      });
      expect(result[0].reps).toBe(12);
      expect(result[0].weight).toBe(90.0);
    });

    it('Strength with algorithmId: "none" resolves to strength_undulating', () => {
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'none',
      });
      // 8-week undulating week 1: 5 reps @ 7.0 (78.6% of 147.0588 = 115.588 -> 115.0 kg)
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(7.0);
      expect(result[0].weight).toBe(115.0);
    });

    it('Strength with algorithmId: undefined resolves to strength_undulating', () => {
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: undefined,
      });
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(7.0);
      expect(result[0].weight).toBe(115.0);
    });

    it('Cross-objective mismatches safely return sets unchanged', () => {
      // Hypertrophy with strength_undulating
      const res1 = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating' as any,
      });
      expect(res1).toEqual(baseEx.sets);

      // Hypertrophy with strength_linear
      const res2 = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_linear' as any,
      });
      expect(res2).toEqual(baseEx.sets);

      // Strength with hypertrophy_linear
      const res3 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'hypertrophy_linear' as any,
      });
      expect(res3).toEqual(baseEx.sets);

      // Strength with hypertrophy_step
      const res4 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'hypertrophy_step' as any,
      });
      expect(res4).toEqual(baseEx.sets);
    });

    it('Unknown runtime algorithm string safely returns sets unchanged', () => {
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'custom_v2' as any,
      });
      expect(result).toEqual(baseEx.sets);
    });
  });

  describe('3. Cold-Start, Modality & Bypasses', () => {
    it('Cold start (no history, no template) prescribes algorithm-derived reps and RPE with weight 0', () => {
      const coldEx: ExerciseEntry = {
        name: 'Incline Dumbbell Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'strict', comment: 'Draft note' },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0, form: 'strict' },
        ],
      };

      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: coldEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [],
        templateExercise: undefined,
        algorithmId: 'hypertrophy_linear',
      });

      expect(result[0].weight).toBe(0);
      expect(result[0].reps).toBe(12);
      expect(result[0].rpe).toBe(8.0);
      expect(result[0].form).toBe('strict');
      expect(result[0].comment).toBe('Draft note');
      expect(result[1].weight).toBe(0);
      expect(result[1].reps).toBe(12);
      expect(result[1].rpe).toBe(8.0);
    });

    it('Actively skipped exercise is preserved unchanged', () => {
      const skippedEx: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        isSkipped: true,
        sets: [{ setNumber: 1, weight: 100, reps: 5, rpe: 8.0 }],
      };
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: skippedEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(result).toEqual(skippedEx.sets);
    });

    it('All five non-weighted modalities bypass target generation completely', () => {
      const modalities = ['bodyweight', 'assisted', 'timed', 'distance', 'distance_loaded'] as const;
      for (const mod of modalities) {
        const ex: ExerciseEntry = {
          name: `${mod} movement`,
          muscleGroup: 'Back',
          modality: mod,
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 7.0 }],
        };
        const result = calculateObjectiveSets({
          objective: 'Hypertrophy',
          exercise: ex,
          weekNum: 1,
          programDuration: 8,
          previousLogs: sampleHistoricalLogs,
          algorithmId: 'hypertrophy_linear',
        });
        expect(result).toEqual(ex.sets);
      }
    });

    it('Strength non-main accessory movements bypass target generation', () => {
      const accessory: ExerciseEntry = {
        name: 'Tricep Rope Pushdown',
        muscleGroup: 'Arms',
        modality: 'weighted',
        isMainMovement: false,
        sets: [{ setNumber: 1, weight: 25, reps: 12, rpe: 8.0 }],
      };
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: accessory,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(result).toEqual(accessory.sets);
    });

    it('Objective Deload preserves existing scalar deload reductions without Phase 2A distribution', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 10, rpe: 0, isWarmup: true },
          { setNumber: 2, weight: 0, reps: 10, rpe: 0, isWarmup: false },
          { setNumber: 3, weight: 0, reps: 10, rpe: 0, isWarmup: false },
        ],
      };
      // Baseline e1RM = 147.0588 kg -> 70% = 102.941 kg -> 50% = 51.47 kg -> rounded = 52.5 kg
      // Deload reps: 10 * 0.6 = 6 reps @ RPE 5.0
      const result = calculateObjectiveSets({
        objective: 'Deload',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
      });

      expect(result[0].isWarmup).toBe(true);
      expect(result[0].form).toBe('strict');
      expect(result[1].isWarmup).toBe(false);
      expect(result[1].weight).toBe(52.5);
      expect(result[1].reps).toBe(6);
      expect(result[1].rpe).toBe(5.0);
      expect(result[1].form).toBe('strict');
      // Set 3 also receives identical deload target
      expect(result[2].weight).toBe(52.5);
      expect(result[2].reps).toBe(6);
      expect(result[2].rpe).toBe(5.0);
    });
  });

  describe('4. Metadata Preservation & Form Invariance', () => {
    it('Preserves form verbatim across strict, standard, loose, null, and undefined and preserves all metadata across updated rows', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'strict', comment: 'C1', isCompleted: true },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0, form: 'standard', comment: 'C2', isCompleted: false },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0, form: 'loose', comment: 'C3', isCompleted: undefined, isDropSet: true, dropSubSets: [{ weight: 40, reps: 5 }] },
          { setNumber: 4, weight: 0, reps: 0, rpe: 0, form: null, comment: 'C4', isWarmup: false },
          { setNumber: 5, weight: 0, reps: 0, rpe: 0, form: undefined, comment: 'C5' },
        ],
      };

      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });

      // Target metrics updated across all rows
      // Week 1 odd week compound fw:
      // Set 1: 90.0 kg x 12 @ 8.0
      // Set 2: 90.0 kg x 12 @ 8.5
      // Set 3: 90.0 kg x 12 @ 9.0
      // Set 4: 90.0 kg x 11 @ 9.0
      // Set 5: 90.0 kg x 10 @ 9.0
      expect(result[0].weight).toBe(90.0);
      expect(result[0].reps).toBe(12);
      expect(result[0].rpe).toBe(8.0);

      expect(result[1].weight).toBe(90.0);
      expect(result[1].reps).toBe(12);
      expect(result[1].rpe).toBe(8.5);

      expect(result[2].weight).toBe(90.0);
      expect(result[2].reps).toBe(12);
      expect(result[2].rpe).toBe(9.0);

      expect(result[3].weight).toBe(90.0);
      expect(result[3].reps).toBe(11);
      expect(result[3].rpe).toBe(9.0);

      expect(result[4].weight).toBe(90.0);
      expect(result[4].reps).toBe(10);
      expect(result[4].rpe).toBe(9.0);

      // Metadata strictly preserved verbatim across all 5 form states and extra properties
      expect(result[0].setNumber).toBe(1);
      expect(result[0].form).toBe('strict');
      expect(result[0].comment).toBe('C1');
      expect(result[0].isCompleted).toBe(true);

      expect(result[1].setNumber).toBe(2);
      expect(result[1].form).toBe('standard');
      expect(result[1].comment).toBe('C2');
      expect(result[1].isCompleted).toBe(false);

      expect(result[2].setNumber).toBe(3);
      expect(result[2].form).toBe('loose');
      expect(result[2].comment).toBe('C3');
      expect(result[2].isCompleted).toBeUndefined();
      expect(result[2].isDropSet).toBe(true);
      expect(result[2].dropSubSets).toEqual([{ weight: 40, reps: 5 }]);

      expect(result[3].setNumber).toBe(4);
      expect(result[3].form).toBeNull();
      expect(result[3].comment).toBe('C4');
      expect(result[3].isWarmup).toBe(false);

      expect(result[4].setNumber).toBe(5);
      expect(result[4].form).toBeUndefined();
      expect(result[4].comment).toBe('C5');
    });
  });

  describe('5. Ordinal Tracking, Protection & Sets Beyond 6', () => {
    it('User-touched Working Set 2 consumes ordinal 2; subsequent Set 3 receives target for ordinal 3', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 2, weight: 130, reps: 5, rpe: 9.5 }, // User touched
          { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        exerciseIndex: 0,
        weekNum: 2, // 8-week DUP: Set 1 = 120.0 kg x 5 @ 8.0
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        userTouchedSets: { '0-1': true }, // Set 2 protected
        checkedSets: {},
        algorithmId: 'strength_undulating',
      });

      // Set 1 (ordinal 1): 117.5 kg x 5 @ 8.0
      expect(result[0].weight).toBe(117.5);
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(8.0);

      // Set 2 (protected): untouched
      expect(result[1].weight).toBe(130);
      expect(result[1].reps).toBe(5);
      expect(result[1].rpe).toBe(9.5);

      // Set 3 (ordinal 3): gets distributed target for ordinal 3 (112.5 kg x 5 @ 7.5), NOT ordinal 2!
      expect(result[2].weight).toBe(112.5);
      expect(result[2].reps).toBe(5);
      expect(result[2].rpe).toBe(7.5);
    });

    it('Checked Working Set 1 is protected from target override while Set 2 receives ordinal 2 target', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 135, reps: 5, rpe: 9.0 }, // Checked
          { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        exerciseIndex: 0,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        userTouchedSets: {},
        checkedSets: { '0-0': true }, // Set 1 checked
        algorithmId: 'strength_undulating',
      });

      // Set 1 (checked): untouched
      expect(result[0].weight).toBe(135);
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(9.0);

      // Set 2 (ordinal 2): gets distributed target for ordinal 2 (112.5 kg x 5 @ 7.0)
      expect(result[1].weight).toBe(112.5);
      expect(result[1].reps).toBe(5);
      expect(result[1].rpe).toBe(7.0);
    });

    it('Checked Working Set 2 consumes ordinal 2; Set 3 receives target for ordinal 3', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 2, weight: 127.5, reps: 5, rpe: 9.0 }, // Checked with distinctive values
          { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        exerciseIndex: 0,
        weekNum: 2, // 8-week DUP: Set 1 = 117.5 kg x 5 @ 8.0
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        userTouchedSets: {},
        checkedSets: { '0-1': true }, // Working Set 2 checked
        algorithmId: 'strength_undulating',
      });

      // Set 1 (unprotected ordinal 1): 117.5 kg x 5 @ 8.0
      expect(result[0].weight).toBe(117.5);
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(8.0);

      // Set 2 (checked): completely unchanged
      expect(result[1].weight).toBe(127.5);
      expect(result[1].reps).toBe(5);
      expect(result[1].rpe).toBe(9.0);

      // Set 3 (ordinal 3): receives generated target for ordinal 3 (112.5 kg x 5 @ 7.5), NOT ordinal 2 (which is 112.5 kg x 5 @ 7.0)
      expect(result[2].weight).toBe(112.5);
      expect(result[2].reps).toBe(5);
      expect(result[2].rpe).toBe(7.5);
    });

    it('Protected Warm-up 1 consumes warm-up position 1 while Warm-up 2 receives position 2 target', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 45.0, reps: 10, rpe: 5.0, isWarmup: true }, // Protected warm-up 1
          { setNumber: 2, weight: 0, reps: 0, rpe: 0, isWarmup: true },       // Unprotected warm-up 2
          { setNumber: 3, weight: 0, reps: 0, rpe: 0, isWarmup: false },      // Working Set 1
          { setNumber: 4, weight: 0, reps: 0, rpe: 0, isWarmup: false },      // Working Set 2
        ],
      };

      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        exerciseIndex: 0,
        weekNum: 2, // 8-week DUP: Set 1 = 117.5 kg x 5 @ 8.0
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        userTouchedSets: {},
        checkedSets: { '0-0': true }, // Warm-up 1 checked
        algorithmId: 'strength_undulating',
      });

      // Warm-up 1 (checked): completely unchanged
      expect(result[0].isWarmup).toBe(true);
      expect(result[0].weight).toBe(45.0);
      expect(result[0].reps).toBe(10);
      expect(result[0].rpe).toBe(5.0);

      // Warm-up 2 (unprotected): receives target for warm-up position 2 (75% of 117.5 kg = 88.125 -> 87.5 kg, reps = max(4, round(5*0.6)) = 4 @ 6.0), NOT position 1 (50% = 60.0 kg x 5 @ 4.0)
      expect(result[1].isWarmup).toBe(true);
      expect(result[1].weight).toBe(87.5);
      expect(result[1].reps).toBe(4);
      expect(result[1].rpe).toBe(6.0);

      // Working Set 1 (ordinal 1 -> 117.5 kg x 5 @ 8.0)
      expect(result[2].isWarmup).toBe(false);
      expect(result[2].weight).toBe(117.5);
      expect(result[2].reps).toBe(5);
      expect(result[2].rpe).toBe(8.0);

      // Working Set 2 (ordinal 2 -> 112.5 kg x 5 @ 7.0)
      expect(result[3].isWarmup).toBe(false);
      expect(result[3].weight).toBe(112.5);
      expect(result[3].reps).toBe(5);
      expect(result[3].rpe).toBe(7.0);
    });

    it('Interleaved warm-up rows do not consume working ordinals', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0, isWarmup: true },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0, isWarmup: true },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0, isWarmup: false },
          { setNumber: 4, weight: 0, reps: 0, rpe: 0, isWarmup: false },
        ],
      };

      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // Warmup 1 (50% of 117.5 = 58.75 -> 60.0 kg)
      expect(result[0].isWarmup).toBe(true);
      expect(result[0].weight).toBe(60.0);

      // Warmup 2 (75% of 117.5 = 88.125 -> 87.5 kg)
      expect(result[1].isWarmup).toBe(true);
      expect(result[1].weight).toBe(87.5);

      // Working Set 1 (ordinal 1 -> 117.5 kg x 5 @ 8.0)
      expect(result[2].isWarmup).toBe(false);
      expect(result[2].weight).toBe(117.5);
      expect(result[2].reps).toBe(5);
      expect(result[2].rpe).toBe(8.0);

      // Working Set 2 (ordinal 2 -> 112.5 kg x 5 @ 7.0)
      expect(result[3].isWarmup).toBe(false);
      expect(result[3].weight).toBe(112.5);
      expect(result[3].reps).toBe(5);
      expect(result[3].rpe).toBe(7.0);
    });

    it('Working sets 7 and 8 remain completely untouched', () => {
      const ex8: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 4, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 5, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 6, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 7, weight: 77.5, reps: 15, rpe: 9.0, comment: 'Set 7 note' },
          { setNumber: 8, weight: 70.0, reps: 20, rpe: 10.0, comment: 'Set 8 note' },
        ],
      };

      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex8,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // Sets 1..6 received distributed targets
      expect(result[0].weight).toBe(117.5);
      expect(result[5].weight).toBe(107.5);

      // Sets 7 and 8 are untouched
      expect(result[6].weight).toBe(77.5);
      expect(result[6].reps).toBe(15);
      expect(result[6].rpe).toBe(9.0);
      expect(result[6].comment).toBe('Set 7 note');

      expect(result[7].weight).toBe(70.0);
      expect(result[7].reps).toBe(20);
      expect(result[7].rpe).toBe(10.0);
      expect(result[7].comment).toBe('Set 8 note');
    });
  });

  describe('6. Historical Fatigue Learning Alpha Blending', () => {
    // Standard 3-set exercise for fatigue integration testing
    const baseEx: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      isMainMovement: true,
      movementCategory: 'compound',
      equipment: 'freeweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
        { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
        { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
      ],
    };

    // Baseline-only historical log: Objective 'Off' provides 100 kg x 10 @ 8.0 (e1RM = 147.0588 kg)
    // but is strictly excluded from fatigue ratio learning because objective is not Hypertrophy or Strength.
    const baselineOnlyLogs: WorkoutLog[] = [
      {
        id: 'baseline-off-log',
        date: '2026-01-01',
        unit: 'kg',
        objective: 'Off',
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false }],
          },
        ],
      },
    ];

    // High fatigue drop session fixture:
    // Set 1: 100 kg x 10 @ 8.0 (e1RM = 147.0588 kg, ratio = 1.000)
    // Set 2: 70 kg x 10 @ 8.0 (e1RM = 102.9412 kg, ratio = 0.700)
    // Set 3: 70 kg x 10 @ 8.0 (e1RM = 102.9412 kg, ratio = 0.700)
    const createLearningSession = (id: string, date: string, set2Weight = 70, set3Weight = 70): WorkoutLog => ({
      id,
      date,
      unit: 'kg',
      objective: 'Strength',
      exercises: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false },
            { setNumber: 2, weight: set2Weight, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false },
            { setNumber: 3, weight: set3Weight, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false },
          ],
        },
      ],
    });

    it('0 eligible learning sessions uses pure prior (alpha = 0.00)', () => {
      const res = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: baselineOnlyLogs,
        algorithmId: 'strength_undulating',
      });

      expect(res[0].weight).toBe(117.5);
      expect(res[0].reps).toBe(5);
      expect(res[0].rpe).toBe(8.0);

      expect(res[1].weight).toBe(112.5);
      expect(res[1].reps).toBe(5);
      expect(res[1].rpe).toBe(7.0);

      expect(res[2].weight).toBe(112.5);
      expect(res[2].reps).toBe(5);
      expect(res[2].rpe).toBe(7.5);
    });

    it('1 eligible learning session blends prior with observed ratio (alpha = 0.33)', () => {
      const session1 = createLearningSession('learn-1', '2026-01-05');
      const res = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: [...baselineOnlyLogs, session1],
        algorithmId: 'strength_undulating',
      });

      expect(res[0].weight).toBe(117.5);
      expect(res[0].reps).toBe(5);
      expect(res[0].rpe).toBe(8.0);

      expect(res[1].weight).toBe(102.5);
      expect(res[1].reps).toBe(5);
      expect(res[1].rpe).toBe(7.0);

      expect(res[2].weight).toBe(102.5);
      expect(res[2].reps).toBe(5);
      expect(res[2].rpe).toBe(7.5);
    });

    it('2 eligible learning sessions blends prior with observed mean (alpha = 0.66)', () => {
      const s1 = createLearningSession('learn-1', '2026-01-05');
      const s2 = createLearningSession('learn-2', '2026-01-10');
      const res = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: [...baselineOnlyLogs, s1, s2],
        algorithmId: 'strength_undulating',
      });

      expect(res[0].weight).toBe(117.5);
      expect(res[0].reps).toBe(5);
      expect(res[0].rpe).toBe(8.0);

      expect(res[1].weight).toBe(90.0);
      expect(res[1].reps).toBe(5);
      expect(res[1].rpe).toBe(7.0);

      expect(res[2].weight).toBe(90.0);
      expect(res[2].reps).toBe(5);
      expect(res[2].rpe).toBe(7.5);
    });

    it('3 eligible learning sessions achieves full learning (alpha = 1.00)', () => {
      const s1 = createLearningSession('learn-1', '2026-01-05');
      const s2 = createLearningSession('learn-2', '2026-01-10');
      const s3 = createLearningSession('learn-3', '2026-01-15');
      const res = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: [...baselineOnlyLogs, s1, s2, s3],
        algorithmId: 'strength_undulating',
      });

      expect(res[0].weight).toBe(117.5);
      expect(res[0].reps).toBe(5);
      expect(res[0].rpe).toBe(8.0);

      expect(res[1].weight).toBe(80.0);
      expect(res[1].reps).toBe(5);
      expect(res[1].rpe).toBe(7.0);

      expect(res[2].weight).toBe(80.0);
      expect(res[2].reps).toBe(5);
      expect(res[2].rpe).toBe(7.5);
    });

    it('More than 3 eligible sessions uses only the 3 most recent sessions and discards older outlier', () => {
      // Oldest session sOld is an outlier (ratio 1.000: Set 2 = 100 kg, Set 3 = 100 kg)
      const sOld = createLearningSession('learn-old', '2026-01-01', 100, 100);
      // 3 recent sessions are heavy fatigue drops (ratio 0.700: Set 2 = 70 kg, Set 3 = 70 kg)
      const s1 = createLearningSession('learn-1', '2026-01-05', 70, 70);
      const s2 = createLearningSession('learn-2', '2026-01-10', 70, 70);
      const s3 = createLearningSession('learn-3', '2026-01-15', 70, 70);

      // Call calculateObjectiveSets with all 4 sessions
      const resWithAll4 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: [...baselineOnlyLogs, sOld, s1, s2, s3],
        algorithmId: 'strength_undulating',
      });

      // Call calculateObjectiveSets with only the 3 recent sessions
      const resWithRecent3 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: [...baselineOnlyLogs, s1, s2, s3],
        algorithmId: 'strength_undulating',
      });

      // Output with all 4 sessions must exactly match output with only 3 recent sessions
      expect(resWithAll4).toEqual(resWithRecent3);
      expect(resWithAll4[1].weight).toBe(80.0);
      expect(resWithAll4[2].weight).toBe(80.0);

      // If the old outlier had been included, median would be different from 0.700
      expect(resWithAll4[1].weight).not.toBe(112.5);
    });
  });

  describe('7. Idempotence, Determinism & Sequential Regeneration', () => {
    it('Calling calculateObjectiveSets 5 consecutive times produces identical results', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      const params = {
        objective: 'Strength' as const,
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating' as const,
      };

      const r1 = calculateObjectiveSets(params);
      const r2 = calculateObjectiveSets(params);
      const r3 = calculateObjectiveSets(params);
      const r4 = calculateObjectiveSets(params);
      const r5 = calculateObjectiveSets(params);

      expect(r1).toEqual(r2);
      expect(r2).toEqual(r3);
      expect(r3).toEqual(r4);
      expect(r4).toEqual(r5);
    });

    it('Sequential 5-generation re-calculation remains strictly idempotent without escalating capacity baseline', () => {
      const templateEx: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isWarmup: false },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0, isWarmup: false },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0, isWarmup: false },
        ],
      };

      // Generation 1
      const gen1Sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: templateEx,
        templateExercise: templateEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // Generation 2: pass gen1 output as exercise.sets
      const gen2Sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: { ...templateEx, sets: gen1Sets },
        templateExercise: templateEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // Generation 3
      const gen3Sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: { ...templateEx, sets: gen2Sets },
        templateExercise: templateEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // Generation 4
      const gen4Sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: { ...templateEx, sets: gen3Sets },
        templateExercise: templateEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // Generation 5
      const gen5Sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: { ...templateEx, sets: gen4Sets },
        templateExercise: templateEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      expect(gen2Sets).toEqual(gen1Sets);
      expect(gen3Sets).toEqual(gen1Sets);
      expect(gen4Sets).toEqual(gen1Sets);
      expect(gen5Sets).toEqual(gen1Sets);

      // Verify exact target metrics did not inflate
      expect(gen5Sets[0].weight).toBe(117.5);
      expect(gen5Sets[0].reps).toBe(5);
      expect(gen5Sets[0].rpe).toBe(8.0);
    });
  });

  describe('8. Strength Undulating Duration Resolution & Unsupported Custom Durations', () => {
    const baseEx: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      isMainMovement: true,
      movementCategory: 'compound',
      equipment: 'freeweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
        { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
      ],
    };

    it('Defined 4-week program uses STRENGTH_PROFILES[4]', () => {
      // 4-week profile week 2: 4 reps @ 8.0, canonical RTS multiplier 0.837 -> 122.5 kg
      const res = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 4,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(res[0].weight).toBe(122.5);
      expect(res[0].reps).toBe(4);
      expect(res[0].rpe).toBe(8.0);
    });

    it('Defined 8-week program uses STRENGTH_PROFILES[8]', () => {
      // 8-week profile week 2: 5 reps @ 8.0, canonical RTS multiplier 0.811 -> 117.5 kg
      const res = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(res[0].weight).toBe(117.5);
      expect(res[0].reps).toBe(5);
      expect(res[0].rpe).toBe(8.0);
    });

    it('Defined 12-week program uses STRENGTH_PROFILES[12]', () => {
      // 12-week profile week 2: 5 reps @ 8.0, canonical RTS multiplier 0.811 -> 117.5 kg
      const res = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 12,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(res[0].weight).toBe(117.5);
      expect(res[0].reps).toBe(5);
      expect(res[0].rpe).toBe(8.0);
    });

    it('Undefined programDuration defaults to defined 8-week profile', () => {
      const res = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: undefined,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(res[0].weight).toBe(117.5);
      expect(res[0].reps).toBe(5);
      expect(res[0].rpe).toBe(8.0);
    });

    it('Custom 6-week program safely bypasses automatic transformation (no modulo wrapping)', () => {
      const w1 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 6,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w1[0].weight).toBe(0);
      expect(w1[0].reps).toBe(0);

      const w2 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 2,
        programDuration: 6,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w2[0].weight).toBe(0);
      expect(w2[0].reps).toBe(0);
    });

    it('Custom 10-week program safely bypasses automatic transformation', () => {
      const w9 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 9,
        programDuration: 10,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w9[0].weight).toBe(0);
      expect(w9[0].reps).toBe(0);

      const w10 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: baseEx,
        weekNum: 10,
        programDuration: 10,
        previousLogs: sampleHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w10[0].weight).toBe(0);
      expect(w10[0].reps).toBe(0);
    });
  });
});
