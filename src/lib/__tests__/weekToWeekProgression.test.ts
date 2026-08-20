import { describe, it, expect } from 'vitest';
import {
  extractHistoricalBaselineE1RM,
  extractTemplateBaselineE1RM,
  calculateObjectiveSets,
  getPermittedRepetitionBounds,
  getRTSMultiplier,
} from '../objectiveMath';
import { WorkoutLog, ExerciseEntry, BodyweightSnapshot } from '../../types';

describe('weekToWeekProgression - Phase AS-2C Stage 2A Direct Semantic Coverage & Parity', () => {
  const standardSnapshotKg: BodyweightSnapshot = {
    value: 80,
    unit: 'kg',
  };

  const standardSnapshotLbs: BodyweightSnapshot = {
    value: 176.3696,
    unit: 'lb',
  };

  describe('1. Repetition Envelopes Policy and Anchor Calculations', () => {
    it('returns exact approved repetition bounds for each modality and objective combination', () => {
      // Hypertrophy compound: [5, 15]
      const hypCompound = getPermittedRepetitionBounds({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        isIsolation: false,
        isMachine: false,
        anchorReps: 12,
      });
      expect(hypCompound).toEqual({ minReps: 5, maxReps: 15 });

      // Hypertrophy isolation: [8, 20]
      const hypIsolation = getPermittedRepetitionBounds({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        isIsolation: true,
        isMachine: false,
        anchorReps: 15,
      });
      expect(hypIsolation).toEqual({ minReps: 8, maxReps: 20 });

      // Strength Undulating main movement: [1, 6]
      const strUndulating = getPermittedRepetitionBounds({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        isIsolation: false,
        isMachine: false,
        anchorReps: 5,
      });
      expect(strUndulating).toEqual({ minReps: 1, maxReps: 6 });

      // Strength Linear main movement: [1, 8]
      const strLinear = getPermittedRepetitionBounds({
        objective: 'Strength',
        algorithmId: 'strength_linear',
        isIsolation: false,
        isMachine: false,
        anchorReps: 5,
      });
      expect(strLinear).toEqual({ minReps: 1, maxReps: 8 });

      // Deload: [1, 15]
      const deloadBounds = getPermittedRepetitionBounds({
        objective: 'Deload',
        isIsolation: false,
        isMachine: false,
        anchorReps: 6,
      });
      expect(deloadBounds).toEqual({ minReps: 1, maxReps: 15 });
    });
  });

  describe('2. Reconciled Bodyweight Target-e1RM Formula & Arithmetic Verification', () => {
    it('reconciles bodyweight template baseline using exact getRTSMultiplier(8, 8.0) = 0.728', () => {
      const templateEx: ExerciseEntry = {
        name: 'Chin-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 8, rpe: 8.0, form: 'standard' }],
      };

      const canonicalMultiplier = getRTSMultiplier(8, 8.0);
      expect(canonicalMultiplier).toBe(0.728);

      const templateE1RM = extractTemplateBaselineE1RM(templateEx, standardSnapshotKg, 'kg');
      expect(templateE1RM).toBeCloseTo(80 / 0.728, 4);
    });

    it('reconciles bodyweight Hypertrophy Step Week 1 arithmetic', () => {
      // Week 1 Block 0 Step 1: compound freeweight anchor is 10 reps @ RPE 7.0
      // Production load percentage = getRTSMultiplier(10, 7.0) = 0.649
      // Baseline e1RM = 100 kg => target load = 64.9 kg => target e1RM = 64.9 / 0.649 = 100.0 kg
      // At 80 kg bodyweight, candidates in [5, 15] evaluated at RPE 7.0:
      // 5 reps @ 7.0 (mult 0.779) => achieved e1RM = 80 / 0.779 = 102.6957 kg (error = 2.6957 kg) -> closest
      const exact100kgLog: WorkoutLog[] = [
        {
          id: 'log-bw-100',
          date: '2026-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 100, unit: 'kg' },
          exercises: [
            {
              name: 'Pull-up',
              muscleGroup: 'Back',
              modality: 'bodyweight',
              sets: [{ setNumber: 1, weight: 0, reps: 1, rpe: 10.0, isCompleted: true, isWarmup: false }],
            },
          ],
        },
      ];

      const baselineE1RM = extractHistoricalBaselineE1RM('Pull-up', exact100kgLog, 'bodyweight', 'kg');
      expect(baselineE1RM).toBe(100);

      const exercise: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
        ],
      };

      const resultSets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: exact100kgLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_step',
        bodyweightSnapshot: standardSnapshotKg, // active BW = 80 kg
        activeUnit: 'kg',
      });

      expect(resultSets.length).toBe(3);
      expect(resultSets[0]).toMatchObject({ weight: 0, reps: 5, rpe: 7.0 });
      expect(resultSets[1]).toMatchObject({ weight: 0, reps: 5, rpe: 7.5 });
      expect(resultSets[2]).toMatchObject({ weight: 0, reps: 5, rpe: 8.0 });
    });

    it('reconciles bodyweight Strength Undulating Week 1 arithmetic', () => {
      // Week 1 Strength Undulating: 5 reps @ RPE 7.0, target1RMPercent = 0.786
      // Target physical effective load = 100 * 0.786 = 78.6 kg
      // Canonical multiplier = getRTSMultiplier(5, 7.0) = 0.779
      // Derived target e1RM = 78.6 / 0.779 = 100.8985879... kg
      // At 80 kg bodyweight across [1, 6]:
      // 4 reps @ 7.0 (mult 0.807) => achieved e1RM = 80 / 0.807 = 99.13259 kg (error = 1.7659 kg)
      // 5 reps @ 7.0 (mult 0.779) => achieved e1RM = 80 / 0.779 = 102.6957 kg (error = 1.7971 kg)
      // 4 reps has strictly lower error than 5 reps!
      const exact100kgLog: WorkoutLog[] = [
        {
          id: 'log-bw-100',
          date: '2026-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 100, unit: 'kg' },
          exercises: [
            {
              name: 'Pull-up',
              muscleGroup: 'Back',
              modality: 'bodyweight',
              sets: [{ setNumber: 1, weight: 0, reps: 1, rpe: 10.0, isCompleted: true, isWarmup: false }],
            },
          ],
        },
      ];

      const exercise: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
        ],
      };

      const resultSets = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: exact100kgLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'strength_undulating',
        bodyweightSnapshot: standardSnapshotKg, // 80 kg
        activeUnit: 'kg',
      });

      expect(resultSets.length).toBe(3);
      expect(resultSets[0]).toMatchObject({ weight: 0, reps: 4, rpe: 7.0 });
      expect(resultSets[1]).toMatchObject({ weight: 0, reps: 3, rpe: 6.0 });
      expect(resultSets[2]).toMatchObject({ weight: 0, reps: 3, rpe: 6.5 });
    });

    it('reconciles bodyweight Strength Linear Week 4 arithmetic', () => {
      // Week 4 of 8: progress = 3/7 = 0.4285714...
      // target1RMPercent = 0.70 + (3/7)*0.30 = 0.8285714...
      // Target load = 100 * 0.8285714 = 82.85714 kg
      // Anchor reps = 5, anchor RPE = 8.5
      // Canonical multiplier = getRTSMultiplier(5, 8.5) = 0.821
      // Derived target e1RM = 82.85714 / 0.821 = 100.9222 kg
      // At 80 kg bodyweight across [1, 8]:
      // 6 reps @ 8.5 (mult 0.793) => achieved e1RM = 80 / 0.793 = 100.8827 kg (error = 0.0395 kg) -> selects 6 reps
      const exact100kgLog: WorkoutLog[] = [
        {
          id: 'log-bw-100',
          date: '2026-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 100, unit: 'kg' },
          exercises: [
            {
              name: 'Pull-up',
              muscleGroup: 'Back',
              modality: 'bodyweight',
              sets: [{ setNumber: 1, weight: 0, reps: 1, rpe: 10.0, isCompleted: true, isWarmup: false }],
            },
          ],
        },
      ];

      const exercise: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
        ],
      };

      const resultSets = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 4,
        programDuration: 8,
        previousLogs: exact100kgLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'strength_linear',
        bodyweightSnapshot: standardSnapshotKg, // 80 kg
        activeUnit: 'kg',
      });

      expect(resultSets.length).toBe(3);
      expect(resultSets[0]).toMatchObject({ weight: 0, reps: 6, rpe: 8.5 });
      expect(resultSets[1]).toMatchObject({ weight: 0, reps: 4, rpe: 7.5 });
      expect(resultSets[2]).toMatchObject({ weight: 0, reps: 4, rpe: 8.0 });
    });
  });

  describe('3. Complete Eight-Combination Integration Matrix', () => {
    const baseline100kgHistoricalLog: WorkoutLog[] = [
      {
        id: 'log-base-100',
        date: '2026-01-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        exercises: [
          {
            name: 'Chest Dip',
            muscleGroup: 'Chest',
            modality: 'assisted',
            sets: [{ setNumber: 1, weight: 0, reps: 1, rpe: 10.0, isCompleted: true, isWarmup: false }],
          },
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 1, rpe: 10.0, isCompleted: true, isWarmup: false }],
          },
        ],
      },
    ];

    // Combination 1: assisted + hypertrophy_linear
    it('directly calculates targets for combination 1: assisted + hypertrophy_linear', () => {
      const exercise: ExerciseEntry = {
        name: 'Chest Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        sets: [
          { setNumber: 1, weight: 0, reps: 8, rpe: 8.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 8, rpe: 8.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 8, rpe: 8.0, form: 'standard' },
        ],
      };

      const targets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2,
        programDuration: 8,
        previousLogs: baseline100kgHistoricalLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(targets.length).toBe(3);
      expect(targets[0]).toMatchObject({ weight: 7.5, reps: 8, rpe: 8.0, form: 'standard' });
      expect(targets[1]).toMatchObject({ weight: 5.0, reps: 7, rpe: 8.5, form: 'standard' });
      expect(targets[2]).toMatchObject({ weight: 5.0, reps: 7, rpe: 9.0, form: 'standard' });
    });

    // Combination 2: bodyweight + hypertrophy_linear
    it('directly calculates targets for combination 2: bodyweight + hypertrophy_linear', () => {
      const exercise: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 6, rpe: 8.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 6, rpe: 8.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 6, rpe: 8.0, form: 'standard' },
        ],
      };

      const targets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2,
        programDuration: 8,
        previousLogs: baseline100kgHistoricalLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(targets.length).toBe(3);
      expect(targets[0]).toMatchObject({ weight: 0, reps: 5, rpe: 8.0, form: 'standard' });
      expect(targets[1]).toMatchObject({ weight: 0, reps: 5, rpe: 8.5, form: 'standard' });
      expect(targets[2]).toMatchObject({ weight: 0, reps: 5, rpe: 9.0, form: 'standard' });
    });

    // Combination 3: assisted + hypertrophy_step
    it('directly calculates targets for combination 3: assisted + hypertrophy_step', () => {
      const exercise: ExerciseEntry = {
        name: 'Chest Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        sets: [
          { setNumber: 1, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
        ],
      };

      const targets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: baseline100kgHistoricalLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_step',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(targets.length).toBe(3);
      expect(targets[0]).toMatchObject({ weight: 22.5, reps: 12, rpe: 7.0, form: 'standard' });
      expect(targets[1]).toMatchObject({ weight: 22.5, reps: 12, rpe: 7.5, form: 'standard' });
      expect(targets[2]).toMatchObject({ weight: 22.5, reps: 12, rpe: 8.0, form: 'standard' });
    });

    // Combination 4: bodyweight + hypertrophy_step
    it('directly calculates targets for combination 4: bodyweight + hypertrophy_step', () => {
      const exercise: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
        ],
      };

      const targets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: baseline100kgHistoricalLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_step',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(targets.length).toBe(3);
      expect(targets[0]).toMatchObject({ weight: 0, reps: 5, rpe: 7.0, form: 'standard' });
      expect(targets[1]).toMatchObject({ weight: 0, reps: 5, rpe: 7.5, form: 'standard' });
      expect(targets[2]).toMatchObject({ weight: 0, reps: 5, rpe: 8.0, form: 'standard' });
    });

    // Combination 5: assisted + strength_undulating (main movement)
    it('directly calculates targets for combination 5: assisted + strength_undulating', () => {
      const exercise: ExerciseEntry = {
        name: 'Chest Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
        ],
      };

      const targets = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: baseline100kgHistoricalLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'strength_undulating',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(targets.length).toBe(3);
      expect(targets[0]).toMatchObject({ weight: 2.5, reps: 5, rpe: 7.0, form: 'standard' });
      expect(targets[1]).toMatchObject({ weight: 7.5, reps: 5, rpe: 6.0, form: 'standard' });
      expect(targets[2]).toMatchObject({ weight: 7.5, reps: 5, rpe: 6.5, form: 'standard' });
    });

    // Combination 6: bodyweight + strength_undulating (main movement)
    it('directly calculates targets for combination 6: bodyweight + strength_undulating', () => {
      const exercise: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
        ],
      };

      const targets = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: baseline100kgHistoricalLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'strength_undulating',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(targets.length).toBe(3);
      expect(targets[0]).toMatchObject({ weight: 0, reps: 4, rpe: 7.0, form: 'standard' });
      expect(targets[1]).toMatchObject({ weight: 0, reps: 3, rpe: 6.0, form: 'standard' });
      expect(targets[2]).toMatchObject({ weight: 0, reps: 3, rpe: 6.5, form: 'standard' });
    });

    // Combination 7: assisted + strength_linear (main movement)
    it('directly calculates targets for combination 7: assisted + strength_linear', () => {
      const exercise: ExerciseEntry = {
        name: 'Chest Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
        ],
      };

      const targets = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 4,
        programDuration: 8,
        previousLogs: baseline100kgHistoricalLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'strength_linear',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(targets.length).toBe(3);
      expect(targets[0]).toMatchObject({ weight: 0, reps: 5, rpe: 8.5, form: 'standard' });
      expect(targets[1]).toMatchObject({ weight: 2.5, reps: 5, rpe: 7.5, form: 'standard' });
      expect(targets[2]).toMatchObject({ weight: 2.5, reps: 5, rpe: 8.0, form: 'standard' });
    });

    // Combination 8: bodyweight + strength_linear (main movement)
    it('directly calculates targets for combination 8: bodyweight + strength_linear', () => {
      const exercise: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
        ],
      };

      const targets = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 4,
        programDuration: 8,
        previousLogs: baseline100kgHistoricalLog,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'strength_linear',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(targets.length).toBe(3);
      expect(targets[0]).toMatchObject({ weight: 0, reps: 6, rpe: 8.5, form: 'standard' });
      expect(targets[1]).toMatchObject({ weight: 0, reps: 4, rpe: 7.5, form: 'standard' });
      expect(targets[2]).toMatchObject({ weight: 0, reps: 4, rpe: 8.0, form: 'standard' });
    });
  });

  describe('4. Hypertrophy Classification and Equipment Modifier Coverage', () => {
    it('applies compound machine modifier (+2 anchor reps) in Step Loading', () => {
      const machineExercise: ExerciseEntry = {
        name: 'Machine Chest Press',
        muscleGroup: 'Chest',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 7.0, form: 'standard' }],
      };

      const targets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: machineExercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [
          {
            id: 'log-mach-1',
            date: '2026-01-01',
            unit: 'kg',
            bodyweightSnapshot: { value: 100, unit: 'kg' },
            exercises: [
              {
                name: 'Machine Chest Press',
                muscleGroup: 'Chest',
                modality: 'assisted',
                sets: [{ setNumber: 1, weight: 0, reps: 1, rpe: 10.0, isCompleted: true, isWarmup: false }],
              },
            ],
          },
        ],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_step',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      // Machine modifier shifts anchor reps to 12
      expect(targets[0].reps).toBe(12);
      expect(targets[0].rpe).toBe(7.0);
    });

    it('applies isolation modifier in Hypertrophy Linear', () => {
      const isoExercise: ExerciseEntry = {
        name: 'Dumbbell Bicep Curl',
        muscleGroup: 'Biceps',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 20, reps: 10, rpe: 8.0, form: 'standard' }],
      };

      const targetsW1 = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: isoExercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [
          {
            id: 'log-iso-1',
            date: '2026-01-01',
            unit: 'kg',
            exercises: [
              {
                name: 'Dumbbell Bicep Curl',
                muscleGroup: 'Biceps',
                modality: 'weighted',
                sets: [{ setNumber: 1, weight: 20, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false }],
              },
            ],
          },
        ],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        activeUnit: 'kg',
      });

      expect(targetsW1[0].reps).toBe(15);
      expect(targetsW1[0].rpe).toBe(8.0);
    });
  });

  describe('5. Direct Policy and Fallback Tests', () => {
    it('never borrows active session bodyweight when historical snapshot is missing', () => {
      const historicalLogsWithoutSnapshot: WorkoutLog[] = [
        {
          id: 'log-no-snap',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Assisted Pull-up',
              muscleGroup: 'Back',
              modality: 'assisted',
              sets: [{ setNumber: 1, weight: 30, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false }],
            },
          ],
        },
      ];

      const baselineE1RM = extractHistoricalBaselineE1RM('Assisted Pull-up', historicalLogsWithoutSnapshot, 'assisted', 'kg');
      expect(baselineE1RM).toBe(0);
    });

    it('falls back to pristine template baseline when historical snapshot is missing', () => {
      const historicalLogsWithoutSnapshot: WorkoutLog[] = [
        {
          id: 'log-no-snap',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Assisted Pull-up',
              muscleGroup: 'Back',
              modality: 'assisted',
              sets: [{ setNumber: 1, weight: 30, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false }],
            },
          ],
        },
      ];

      const templateEx: ExerciseEntry = {
        name: 'Assisted Pull-up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 30, reps: 10, rpe: 8.0, form: 'standard' }],
      };

      const targets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: templateEx,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2,
        programDuration: 8,
        previousLogs: historicalLogsWithoutSnapshot,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        templateExercise: templateEx,
        bodyweightSnapshot: standardSnapshotKg, // 80 kg
        activeUnit: 'kg',
      });

      // Assisted compound machine in Week 2 Heavy: 8 reps @ 8.0 (multiplier = 0.728)
      // Template effective load = 80 - 30 = 50 kg => e1RM = 50 / 0.680 = 73.5294 kg
      // Target load = 73.5294 * 0.728 = 53.5294 kg => assist = 80 - 53.5294 = 26.47 kg => rounded 27.5 kg
      expect(targets[0].weight).toBe(27.5);
      expect(targets[0].reps).toBe(8);
      expect(targets[0].rpe).toBe(8.0);
    });

    it('leaves sets completely unchanged when active bodyweight snapshot is missing and no valid baseline exists', () => {
      const exercise: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 8, rpe: 8.0, form: 'standard' }],
      };

      const targets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: null,
        activeUnit: 'kg',
      });

      expect(targets).toEqual(exercise.sets);
    });

    it('includes zero-assistance historical sets in assisted baseline extraction', () => {
      const zeroAssistLog: WorkoutLog[] = [
        {
          id: 'log-zero-assist',
          date: '2026-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          exercises: [
            {
              name: 'Assisted Dip',
              muscleGroup: 'Chest',
              modality: 'assisted',
              sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false }],
            },
          ],
        },
      ];

      // Effective load = 80 - 0 = 80 kg => e1RM = 80 / 0.680 = 117.647 kg
      const baselineE1RM = extractHistoricalBaselineE1RM('Assisted Dip', zeroAssistLog, 'assisted', 'kg');
      expect(baselineE1RM).toBeCloseTo(80 / 0.680, 2);
    });

    it('excludes assisted historical sets where assistance equals or exceeds session bodyweight', () => {
      const invalidAssistLog: WorkoutLog[] = [
        {
          id: 'log-bad-assist',
          date: '2026-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          exercises: [
            {
              name: 'Assisted Dip',
              muscleGroup: 'Chest',
              modality: 'assisted',
              sets: [{ setNumber: 1, weight: 85, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false }],
            },
          ],
        },
      ];

      const baselineE1RM = extractHistoricalBaselineE1RM('Assisted Dip', invalidAssistLog, 'assisted', 'kg');
      expect(baselineE1RM).toBe(0);
    });

    it('bypasses Strength algorithm for bodyweight and assisted non-main accessories', () => {
      const bwAccessory: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        isMainMovement: false,
        sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8.0, form: 'standard' }],
      };

      const asAccessory: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        isMainMovement: false,
        sets: [{ setNumber: 1, weight: 20, reps: 10, rpe: 8.0, form: 'standard' }],
      };

      const bwResult = calculateObjectiveSets({
        objective: 'Strength',
        exercise: bwAccessory,
        weekNum: 1,
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });
      expect(bwResult).toEqual(bwAccessory.sets);

      const asResult = calculateObjectiveSets({
        objective: 'Strength',
        exercise: asAccessory,
        weekNum: 1,
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });
      expect(asResult).toEqual(asAccessory.sets);
    });

    it('bypasses Objective Off for bodyweight and assisted exercises', () => {
      const bwEx: ExerciseEntry = {
        name: 'Push-up',
        muscleGroup: 'Chest',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 15, rpe: 8.0, form: 'standard' }],
      };

      const asEx: ExerciseEntry = {
        name: 'Assisted Pull-up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 25, reps: 8, rpe: 8.0, form: 'standard' }],
      };

      expect(calculateObjectiveSets({ objective: 'Off', exercise: bwEx, weekNum: 1 })).toEqual(bwEx.sets);
      expect(calculateObjectiveSets({ objective: 'Off', exercise: asEx, weekNum: 1 })).toEqual(asEx.sets);
    });

    it('leaves unsupported modalities (timed, distance, distance_loaded) completely unchanged', () => {
      const timedEx: ExerciseEntry = {
        name: 'Plank',
        muscleGroup: 'Core',
        modality: 'timed',
        sets: [{ setNumber: 1, reps: 60, rpe: 8.0, form: 'standard' }],
      };

      const distEx: ExerciseEntry = {
        name: 'Rowing',
        muscleGroup: 'Cardio',
        modality: 'distance',
        sets: [{ setNumber: 1, reps: 500, form: 'standard' }],
      };

      expect(calculateObjectiveSets({ objective: 'Hypertrophy', exercise: timedEx, weekNum: 1 })).toEqual(timedEx.sets);
      expect(calculateObjectiveSets({ objective: 'Hypertrophy', exercise: distEx, weekNum: 1 })).toEqual(distEx.sets);
    });

    it('keeps warm-up rows unchanged and maintains aligned working set ordinals', () => {
      const bwWithWarmup: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 5, rpe: 4.0, isWarmup: true, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 10, rpe: 8.0, isWarmup: false, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 10, rpe: 8.0, isWarmup: false, form: 'standard' },
        ],
      };

      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: bwWithWarmup,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2,
        programDuration: 8,
        previousLogs: [
          {
            id: 'log-base-100',
            date: '2026-01-01',
            unit: 'kg',
            bodyweightSnapshot: { value: 100, unit: 'kg' },
            exercises: [
              {
                name: 'Pull-up',
                muscleGroup: 'Back',
                modality: 'bodyweight',
                sets: [{ setNumber: 1, weight: 0, reps: 1, rpe: 10.0, isCompleted: true, isWarmup: false }],
              },
            ],
          },
        ],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(result[0]).toEqual(bwWithWarmup.sets[0]); // Warmup unchanged
      expect(result[1].isWarmup).toBeFalsy();
      expect(result[1].weight).toBe(0);
      expect(result[1].reps).toBe(5); // Working set 1 target
    });

    it('handles deload correctly for assisted modality', () => {
      const templateEx: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 20, reps: 10, rpe: 8.0, form: 'standard' }],
      };

      const result = calculateObjectiveSets({
        objective: 'Deload',
        exercise: templateEx,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 4,
        programDuration: 8,
        previousLogs: [
          {
            id: 'log-del-1',
            date: '2026-01-01',
            unit: 'kg',
            bodyweightSnapshot: { value: 80, unit: 'kg' },
            exercises: [
              {
                name: 'Assisted Dip',
                muscleGroup: 'Chest',
                modality: 'assisted',
                sets: [{ setNumber: 1, weight: 20, reps: 10, rpe: 8.0, isCompleted: true, isWarmup: false }],
              },
            ],
          },
        ],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg',
      });

      expect(result[0].rpe).toBe(5.0);
      expect(result[0].weight).toBeGreaterThan(0);
      expect((result[0].weight ?? 0) % 2.5).toBe(0);
    });

    it('guarantees deep immutability and idempotency without target drift across 5 iterations', () => {
      const templateEx: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 8, rpe: 8.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 8, rpe: 8.0, form: 'standard' },
        ],
      };

      const historicalLogs: WorkoutLog[] = [
        {
          id: 'log-base-100',
          date: '2026-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 100, unit: 'kg' },
          exercises: [
            {
              name: 'Pull-up',
              muscleGroup: 'Back',
              modality: 'bodyweight',
              sets: [{ setNumber: 1, weight: 0, reps: 1, rpe: 10.0, isCompleted: true, isWarmup: false }],
            },
          ],
        },
      ];

      const templateCopy = JSON.parse(JSON.stringify(templateEx));
      const logsCopy = JSON.parse(JSON.stringify(historicalLogs));

      const params = {
        objective: 'Hypertrophy' as const,
        exercise: templateEx,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2,
        programDuration: 8,
        previousLogs: historicalLogs,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear' as const,
        bodyweightSnapshot: standardSnapshotKg,
        activeUnit: 'kg' as const,
      };

      let currentSets = calculateObjectiveSets(params);
      const initialCalculated = JSON.parse(JSON.stringify(currentSets));

      // Run 4 more times using the calculated sets as active exercise sets
      for (let i = 0; i < 4; i++) {
        const nextExercise = { ...templateEx, sets: currentSets };
        currentSets = calculateObjectiveSets({ ...params, exercise: nextExercise });
      }

      // Assert template and historical logs remain deeply unmodified
      expect(templateEx).toEqual(templateCopy);
      expect(historicalLogs).toEqual(logsCopy);

      // Assert 5 repeated iterations yield identical targets without drift
      expect(currentSets).toEqual(initialCalculated);
    });
  });

  describe('6. Weighted Regression Parity Tests (All 4 Algorithms)', () => {
    const historicalWeightedLogs: WorkoutLog[] = [
      {
        id: 'log-w-100',
        date: '2026-01-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10.0, isCompleted: true, isWarmup: false }],
          },
        ],
      },
    ];

    it('matches pre-Stage-2A expectations for weighted Hypertrophy Linear', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 0, reps: 6, rpe: 8.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 6, rpe: 8.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 6, rpe: 8.0, form: 'standard' },
        ],
      };

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2,
        programDuration: 8,
        previousLogs: historicalWeightedLogs,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        activeUnit: 'kg',
      });

      expect(sets[0]).toMatchObject({ weight: 77.5, reps: 6, rpe: 8.0, form: 'standard' });
      expect(sets[1]).toMatchObject({ weight: 77.5, reps: 5, rpe: 8.5, form: 'standard' });
      expect(sets[2]).toMatchObject({ weight: 77.5, reps: 5, rpe: 9.0, form: 'standard' });
    });

    it('matches pre-Stage-2A expectations for weighted Hypertrophy Step', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 10, rpe: 7.0, form: 'standard' },
        ],
      };

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: historicalWeightedLogs,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_step',
        activeUnit: 'kg',
      });

      expect(sets[0]).toMatchObject({ weight: 65.0, reps: 10, rpe: 7.0, form: 'standard' });
      expect(sets[1]).toMatchObject({ weight: 65.0, reps: 9, rpe: 7.5, form: 'standard' });
      expect(sets[2]).toMatchObject({ weight: 65.0, reps: 9, rpe: 8.0, form: 'standard' });
    });

    it('matches pre-Stage-2A expectations for weighted Strength Undulating', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 5, rpe: 7.0, form: 'standard' },
        ],
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: historicalWeightedLogs,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'strength_undulating',
        activeUnit: 'kg',
      });

      expect(sets[0]).toMatchObject({ weight: 77.5, reps: 5, rpe: 7.0, form: 'standard' });
      expect(sets[1]).toMatchObject({ weight: 72.5, reps: 5, rpe: 6.0, form: 'standard' });
      expect(sets[2]).toMatchObject({ weight: 72.5, reps: 5, rpe: 6.5, form: 'standard' });
    });

    it('matches pre-Stage-2A expectations for weighted Strength Linear', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 5, rpe: 8.5, form: 'standard' },
        ],
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 4,
        programDuration: 8,
        previousLogs: historicalWeightedLogs,
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'strength_linear',
        activeUnit: 'kg',
      });

      expect(sets[0]).toMatchObject({ weight: 82.5, reps: 5, rpe: 8.5, form: 'standard' });
      expect(sets[1]).toMatchObject({ weight: 77.5, reps: 5, rpe: 7.5, form: 'standard' });
      expect(sets[2]).toMatchObject({ weight: 77.5, reps: 5, rpe: 8.0, form: 'standard' });
    });
  });

  describe('Phase AS-4A: Bodyweight and Assisted Multi-Set Target Generation with Learned Historical Fatigue', () => {
    const bw100Snapshot: BodyweightSnapshot = { value: 100, unit: 'kg' };

    // Fixture A: 1 observation
    const bwLogWeek2: WorkoutLog = {
      id: 'log-bw-w2',
      date: '2026-08-01',
      unit: 'kg',
      objective: 'Hypertrophy',
      bodyweightSnapshot: bw100Snapshot,
      exercises: [
        {
          name: 'Pull-up',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          sets: [
            { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true, form: 'standard' },
            { setNumber: 2, weight: 0, reps: 8, rpe: 8.5, isCompleted: true, form: 'standard' },
            { setNumber: 3, weight: 0, reps: 7, rpe: 9.0, isCompleted: true, form: 'standard' },
          ],
        },
      ],
    };

    // Fixture B: 2nd observation
    const bwLogWeek3: WorkoutLog = {
      id: 'log-bw-w3',
      date: '2026-08-08',
      unit: 'kg',
      objective: 'Hypertrophy',
      bodyweightSnapshot: bw100Snapshot,
      exercises: [
        {
          name: 'Pull-up',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          sets: [
            { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true, form: 'standard' },
            { setNumber: 2, weight: 0, reps: 7, rpe: 8.5, isCompleted: true, form: 'standard' },
            { setNumber: 3, weight: 0, reps: 4, rpe: 10.0, isCompleted: true, form: 'standard' },
          ],
        },
      ],
    };

    const pullUpExercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, form: 'standard' },
        { setNumber: 2, weight: 0, reps: 10, rpe: 8.0, form: 'standard' },
        { setNumber: 3, weight: 0, reps: 10, rpe: 8.0, form: 'standard' },
      ],
    };

    it('Fixture A: adjusts bodyweight target repetitions to 10 / 9 / 9 after 1 fatigue observation', () => {
      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: pullUpExercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2, // Even week: anchor is 10 reps @ RPE 8.0 for compound
        programDuration: 8,
        previousLogs: [bwLogWeek2],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: bw100Snapshot,
        activeUnit: 'kg',
      });

      expect(sets).toHaveLength(3);
      // Set 1: 10 reps @ RPE 8.0
      expect(sets[0]).toMatchObject({ weight: 0, reps: 10, rpe: 8.0 });
      // Set 2: 9 reps @ RPE 8.5 (adjusted from default 10 reps due to alpha=0.33 blended fatigue)
      expect(sets[1]).toMatchObject({ weight: 0, reps: 9, rpe: 8.5 });
      // Set 3: 9 reps @ RPE 9.0 (adjusted from default 10 reps due to alpha=0.33 blended fatigue)
      expect(sets[2]).toMatchObject({ weight: 0, reps: 9, rpe: 9.0 });
    });

    it('Fixture B: adjusts bodyweight target repetitions to 10 / 8 / 7 after 2 fatigue observations', () => {
      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: pullUpExercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2, // Even week: anchor is 10 reps @ RPE 8.0
        programDuration: 8,
        previousLogs: [bwLogWeek2, bwLogWeek3],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: bw100Snapshot,
        activeUnit: 'kg',
      });

      expect(sets).toHaveLength(3);
      // Set 1: 10 reps @ RPE 8.0
      expect(sets[0]).toMatchObject({ weight: 0, reps: 10, rpe: 8.0 });
      // Set 2: 8 reps @ RPE 8.5 (adjusted to 8 reps due to alpha=0.66 median blended fatigue)
      expect(sets[1]).toMatchObject({ weight: 0, reps: 8, rpe: 8.5 });
      // Set 3: 7 reps @ RPE 9.0 (adjusted to 7 reps due to alpha=0.66 median blended fatigue)
      expect(sets[2]).toMatchObject({ weight: 0, reps: 7, rpe: 9.0 });
    });

    it('retains default 10 / 10 / 10 targets when no eligible historical observations exist (priors only)', () => {
      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: pullUpExercise,
        templateExercise: pullUpExercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2,
        programDuration: 8,
        previousLogs: [], // No history
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: bw100Snapshot,
        activeUnit: 'kg',
      });

      // Default priors: 10 @ 8.0, 10 @ 8.5, 10 @ 9.0
      expect(sets).toHaveLength(3);
      expect(sets[0]).toMatchObject({ weight: 0, reps: 10, rpe: 8.0 });
      expect(sets[1]).toMatchObject({ weight: 0, reps: 10, rpe: 8.5 });
      expect(sets[2]).toMatchObject({ weight: 0, reps: 10, rpe: 9.0 });
    });

    it('prescribes assisted targets on 2.5 kg assistance grid reflecting learned historical fatigue', () => {
      const bw80Snapshot: BodyweightSnapshot = { value: 80, unit: 'kg' };

      // Historical assisted session: Set 1: 10 kg asst x 10 @ 8.0 (eff = 70 kg), Set 2: 20 kg asst x 10 @ 8.5 (eff = 60 kg)
      const assistedLog: WorkoutLog = {
        id: 'log-asst-1',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: bw80Snapshot,
        exercises: [
          {
            name: 'Assisted Pull-up',
            muscleGroup: 'Back',
            modality: 'assisted',
            sets: [
              { setNumber: 1, weight: 10, reps: 10, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 20, reps: 10, rpe: 8.5, isCompleted: true },
            ],
          },
        ],
      };

      const asstExercise: ExerciseEntry = {
        name: 'Assisted Pull-up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [
          { setNumber: 1, weight: 10, reps: 10, rpe: 8.0, form: 'standard' },
          { setNumber: 2, weight: 10, reps: 10, rpe: 8.0, form: 'standard' },
        ],
      };

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: asstExercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2,
        programDuration: 8,
        previousLogs: [assistedLog],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: bw80Snapshot,
        activeUnit: 'kg',
      });

      expect(sets).toHaveLength(2);
      const set0Weight = sets[0]?.weight ?? 0;
      const set1Weight = sets[1]?.weight ?? 0;
      expect(set0Weight % 2.5).toBe(0);
      expect(set1Weight % 2.5).toBe(0);
      // Assistance in Set 2 should be higher (more assistance = less effective load) to account for fatigue
      expect(set1Weight).toBeGreaterThanOrEqual(set0Weight);
    });
  });
});
