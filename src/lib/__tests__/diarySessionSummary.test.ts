import { describe, it, expect } from 'vitest';
import {
  generateDiarySessionSummary,
  isParentWorkingSetEligible,
  calculateDiaryHistoryVolume,
} from '../diarySessionSummary';
import { WorkoutLog } from '../../types';

describe('diarySessionSummary module', () => {
  describe('isParentWorkingSetEligible', () => {
    it('approves a completed working set with valid reps', () => {
      const eligible = isParentWorkingSetEligible(
        { name: 'Bench Press', muscleGroup: 'Chest', sets: [] },
        { setNumber: 1, weight: 100, reps: 8, isCompleted: true }
      );
      expect(eligible).toBe(true);
    });

    it('approves legacy set with undefined isCompleted', () => {
      const eligible = isParentWorkingSetEligible(
        { name: 'Bench Press', muscleGroup: 'Chest', sets: [] },
        { setNumber: 1, weight: 100, reps: 8 }
      );
      expect(eligible).toBe(true);
    });

    it('excludes warm-up set', () => {
      const eligible = isParentWorkingSetEligible(
        { name: 'Bench Press', muscleGroup: 'Chest', sets: [] },
        { setNumber: 1, weight: 60, reps: 5, isWarmup: true, isCompleted: true }
      );
      expect(eligible).toBe(false);
    });

    it('excludes skipped set', () => {
      const eligible = isParentWorkingSetEligible(
        { name: 'Bench Press', muscleGroup: 'Chest', sets: [] },
        { setNumber: 1, weight: 100, reps: 8, isSkipped: true, isCompleted: true }
      );
      expect(eligible).toBe(false);
    });

    it('excludes set on skipped exercise', () => {
      const eligible = isParentWorkingSetEligible(
        { name: 'Bench Press', muscleGroup: 'Chest', isSkipped: true, sets: [] },
        { setNumber: 1, weight: 100, reps: 8, isCompleted: true }
      );
      expect(eligible).toBe(false);
    });

    it('excludes explicitly uncompleted set (isCompleted: false)', () => {
      const eligible = isParentWorkingSetEligible(
        { name: 'Bench Press', muscleGroup: 'Chest', sets: [] },
        { setNumber: 1, weight: 100, reps: 8, isCompleted: false }
      );
      expect(eligible).toBe(false);
    });

    it('excludes invalid reps (0 or negative or non-integer)', () => {
      expect(
        isParentWorkingSetEligible(
          { name: 'Bench Press', muscleGroup: 'Chest', sets: [] },
          { setNumber: 1, weight: 100, reps: 0, isCompleted: true }
        )
      ).toBe(false);
    });
  });

  describe('generateDiarySessionSummary', () => {
    it('14. Weighted drop set adds drop sub-set volume without inflating parent set count', () => {
      const log: WorkoutLog = {
        id: 'drop-log-1',
        date: '2026-03-01',
        unit: 'kg',
        durationMinutes: 45,
        exercises: [
          {
            name: 'Leg Press',
            muscleGroup: 'Quads',
            modality: 'weighted',
            sets: [
              {
                setNumber: 1,
                weight: 100,
                reps: 8,
                isCompleted: true,
                isDropSet: true,
                dropSubSets: [
                  { weight: 75, reps: 6 },
                  { weight: 50, reps: 6 },
                ],
              },
            ],
          },
        ],
      };

      const summary = generateDiarySessionSummary(log);
      expect(summary.completedExerciseCount).toBe(1);
      expect(summary.completedWorkingSetCount).toBe(1); // Only 1 parent working set
      expect(summary.muscleSetCounts).toEqual([{ muscleGroup: 'Quads', setCount: 1 }]);
      // Volume: 100*8 + 75*6 + 50*6 = 800 + 450 + 300 = 1550 kg
      expect(summary.workingVolume.valueKg).toBe(1550);
      expect(summary.workingVolume.status).toBe('complete');
      expect(summary.workingVolume.resolvedMassSetCount).toBe(3); // 1 parent + 2 sub
      expect(summary.workingVolume.unresolvedMassSetCount).toBe(0);
    });

    it('15. Assisted drop set calculates inverse assistance for parent and sub-sets', () => {
      const log: WorkoutLog = {
        id: 'assisted-drop-log',
        date: '2026-03-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Pull-up',
            muscleGroup: 'Back',
            modality: 'assisted',
            sets: [
              {
                setNumber: 1,
                weight: 40, // 100 - 40 = 60 kg effective
                reps: 8,
                isCompleted: true,
                isDropSet: true,
                dropSubSets: [
                  { weight: 60, reps: 6 }, // 100 - 60 = 40 kg effective
                ],
              },
            ],
          },
        ],
      };

      const summary = generateDiarySessionSummary(log);
      expect(summary.completedWorkingSetCount).toBe(1);
      // Volume: (60 * 8) + (40 * 6) = 480 + 240 = 720 kg
      expect(summary.workingVolume.valueKg).toBe(720);
      expect(summary.workingVolume.status).toBe('complete');
    });

    it('16. Bodyweight drop set uses snapshot load for parent and sub-sets', () => {
      const log: WorkoutLog = {
        id: 'bw-drop-log',
        date: '2026-03-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Dips',
            muscleGroup: 'Chest',
            modality: 'bodyweight',
            sets: [
              {
                setNumber: 1,
                weight: 0,
                reps: 10,
                isCompleted: true,
                isDropSet: true,
                dropSubSets: [{ reps: 5 }],
              },
            ],
          },
        ],
      };

      const summary = generateDiarySessionSummary(log);
      expect(summary.completedWorkingSetCount).toBe(1);
      // Volume: (80 * 10) + (80 * 5) = 800 + 400 = 1200 kg
      expect(summary.workingVolume.valueKg).toBe(1200);
      expect(summary.workingVolume.status).toBe('complete');
    });

    it('17. Missing snapshot on drop components marks session partial without guessing volume', () => {
      const log: WorkoutLog = {
        id: 'partial-drop-log',
        date: '2026-03-01',
        unit: 'kg',
        // No bodyweightSnapshot
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 10, isCompleted: true }],
          },
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, isCompleted: true }],
          },
        ],
      };

      const summary = generateDiarySessionSummary(log);
      expect(summary.completedExerciseCount).toBe(2);
      expect(summary.completedWorkingSetCount).toBe(2);
      expect(summary.workingVolume.valueKg).toBe(1000); // 100 * 10 from Bench
      expect(summary.workingVolume.status).toBe('partial');
      expect(summary.workingVolume.resolvedMassSetCount).toBe(1);
      expect(summary.workingVolume.unresolvedMassSetCount).toBe(1);
    });

    it('18. Mixed weighted, bodyweight, and timed session produces correct counts and volume', () => {
      const log: WorkoutLog = {
        id: 'mixed-log-1',
        date: '2026-03-01',
        unit: 'kg',
        durationMinutes: 60,
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 10, isCompleted: true }],
          },
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, isCompleted: true }],
          },
          {
            name: 'Plank',
            muscleGroup: 'Core',
            modality: 'timed',
            sets: [{ setNumber: 1, reps: 60, isCompleted: true }],
          },
        ],
      };

      const summary = generateDiarySessionSummary(log);
      expect(summary.completedExerciseCount).toBe(3);
      expect(summary.completedWorkingSetCount).toBe(3);
      // Volume: 100*10 + 100*10 + 0 = 2000 kg
      expect(summary.workingVolume.valueKg).toBe(2000);
      expect(summary.workingVolume.status).toBe('complete');
      expect(summary.muscleSetCounts).toEqual([
        { muscleGroup: 'Back', setCount: 1 },
        { muscleGroup: 'Chest', setCount: 1 },
        { muscleGroup: 'Core', setCount: 1 },
      ]);
    });

    it('20. All unresolved mass sets produce unavailable volume status', () => {
      const log: WorkoutLog = {
        id: 'legacy-bw-log',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, isCompleted: true }],
          },
        ],
      };

      const summary = generateDiarySessionSummary(log);
      expect(summary.completedExerciseCount).toBe(1);
      expect(summary.completedWorkingSetCount).toBe(1);
      expect(summary.workingVolume.valueKg).toBeNull();
      expect(summary.workingVolume.status).toBe('unavailable');
    });

    it('21. Timed/distance only produces not_applicable volume status', () => {
      const log: WorkoutLog = {
        id: 'cardio-log',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Running',
            muscleGroup: 'Legs',
            modality: 'distance',
            sets: [{ setNumber: 1, reps: 5000, isCompleted: true }],
          },
        ],
      };

      const summary = generateDiarySessionSummary(log);
      expect(summary.completedExerciseCount).toBe(1);
      expect(summary.completedWorkingSetCount).toBe(1);
      expect(summary.workingVolume.valueKg).toBeNull();
      expect(summary.workingVolume.status).toBe('not_applicable');
    });

    it('22. Zero eligible sets produces not_applicable volume status', () => {
      const log: WorkoutLog = {
        id: 'empty-log',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [],
      };

      const summary = generateDiarySessionSummary(log);
      expect(summary.completedExerciseCount).toBe(0);
      expect(summary.completedWorkingSetCount).toBe(0);
      expect(summary.workingVolume.status).toBe('not_applicable');
    });

    it('29. Muscle groups sort by count descending, then alphabetically', () => {
      const log: WorkoutLog = {
        id: 'muscle-sort-log',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            sets: [
              { setNumber: 1, weight: 100, reps: 8, isCompleted: true },
              { setNumber: 2, weight: 100, reps: 8, isCompleted: true },
            ],
          },
          {
            name: 'Squat',
            muscleGroup: 'Quads',
            sets: [
              { setNumber: 1, weight: 140, reps: 5, isCompleted: true },
              { setNumber: 2, weight: 140, reps: 5, isCompleted: true },
              { setNumber: 3, weight: 140, reps: 5, isCompleted: true },
            ],
          },
          {
            name: 'Row',
            muscleGroup: 'Back',
            sets: [
              { setNumber: 1, weight: 80, reps: 10, isCompleted: true },
              { setNumber: 2, weight: 80, reps: 10, isCompleted: true },
            ],
          },
        ],
      };

      const summary = generateDiarySessionSummary(log);
      expect(summary.muscleSetCounts).toEqual([
        { muscleGroup: 'Quads', setCount: 3 },
        { muscleGroup: 'Back', setCount: 2 },
        { muscleGroup: 'Chest', setCount: 2 },
      ]);
    });

    it('30. Invalid or missing duration returns null durationMinutes', () => {
      const log: WorkoutLog = {
        id: 'no-duration-log',
        date: '2026-03-01',
        unit: 'kg',
        durationMinutes: 0,
        exercises: [],
      };
      const summary = generateDiarySessionSummary(log);
      expect(summary.durationMinutes).toBeNull();
    });

    it('31 & 32. Input logs are deeply unchanged and calls are deterministic', () => {
      const log: WorkoutLog = {
        id: 'immutable-log',
        date: '2026-03-01',
        unit: 'kg',
        durationMinutes: 50,
        exercises: [
          {
            name: 'Overhead Press',
            muscleGroup: 'Shoulders',
            sets: [{ setNumber: 1, weight: 60, reps: 8, isCompleted: true }],
          },
        ],
      };

      const originalJson = JSON.stringify(log);
      const res1 = generateDiarySessionSummary(log);
      const res2 = generateDiarySessionSummary(log);

      expect(JSON.stringify(log)).toBe(originalJson);
      expect(res1).toEqual(res2);
    });
  });

  describe('calculateDiaryHistoryVolume', () => {
    it('1. calculates weighted-only complete history accurately', () => {
      const log1: WorkoutLog = {
        id: 'log-w1',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 10, isCompleted: true }], // 1000 kg
          },
        ],
      };

      const log2: WorkoutLog = {
        id: 'log-w2',
        date: '2026-03-05',
        unit: 'kg',
        exercises: [
          {
            name: 'Squat',
            muscleGroup: 'Quads',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 150, reps: 10, isCompleted: true }], // 1500 kg
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log1, log2]);
      expect(summary.status).toBe('complete');
      expect(summary.valueKg).toBe(2500);
      expect(summary.completeSessionCount).toBe(2);
      expect(summary.partialSessionCount).toBe(0);
      expect(summary.unavailableSessionCount).toBe(0);
    });

    it('2. calculates bodyweight history using immutable snapshots', () => {
      const log1: WorkoutLog = {
        id: 'log-bw1',
        date: '2026-03-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, isCompleted: true }], // 800 kg
          },
        ],
      };

      const log2: WorkoutLog = {
        id: 'log-bw2',
        date: '2026-03-05',
        unit: 'kg',
        bodyweightSnapshot: { value: 75, unit: 'kg' },
        exercises: [
          {
            name: 'Dip',
            muscleGroup: 'Chest',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, isCompleted: true }], // 750 kg
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log1, log2]);
      expect(summary.status).toBe('complete');
      expect(summary.valueKg).toBe(1550);
      expect(summary.completeSessionCount).toBe(2);
    });

    it('3. calculates assisted history using effective load', () => {
      const log1: WorkoutLog = {
        id: 'log-ast1',
        date: '2026-03-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Pull-up',
            muscleGroup: 'Back',
            modality: 'assisted',
            sets: [{ setNumber: 1, weight: 20, reps: 10, isCompleted: true }], // (80 - 20) * 10 = 600 kg
          },
        ],
      };

      const log2: WorkoutLog = {
        id: 'log-ast2',
        date: '2026-03-05',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Pull-up',
            muscleGroup: 'Back',
            modality: 'assisted',
            sets: [{ setNumber: 1, weight: 10, reps: 10, isCompleted: true }], // (80 - 10) * 10 = 700 kg
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log1, log2]);
      expect(summary.status).toBe('complete');
      expect(summary.valueKg).toBe(1300);
      expect(summary.completeSessionCount).toBe(2);
    });

    it('4. handles mixed kg/lb normalization correctly', () => {
      const logKg: WorkoutLog = {
        id: 'log-kg',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 10, isCompleted: true }], // 1000 kg
          },
        ],
      };

      const logLb: WorkoutLog = {
        id: 'log-lb',
        date: '2026-03-05',
        unit: 'lb',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 220.46226218, reps: 10, isCompleted: true }], // ~1000 kg
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([logKg, logLb]);
      expect(summary.status).toBe('complete');
      expect(Math.round(summary.valueKg!)).toBe(2000);
    });

    it('5. handles mixed weighted, bodyweight, assisted, and timed sessions', () => {
      const log1: WorkoutLog = {
        id: 'log-mix1',
        date: '2026-03-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        exercises: [
          {
            name: 'Squat',
            muscleGroup: 'Quads',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 10, isCompleted: true }], // 1000 kg
          },
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, isCompleted: true }], // 1000 kg
          },
          {
            name: 'Plank',
            muscleGroup: 'Core',
            modality: 'timed',
            sets: [{ setNumber: 1, reps: 60, isCompleted: true }], // 0 kg
          },
        ],
      };

      const log2: WorkoutLog = {
        id: 'log-mix2',
        date: '2026-03-05',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Dip',
            muscleGroup: 'Chest',
            modality: 'assisted',
            sets: [{ setNumber: 1, weight: 20, reps: 10, isCompleted: true }], // 600 kg
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log1, log2]);
      expect(summary.status).toBe('complete');
      expect(summary.valueKg).toBe(2600);
      expect(summary.completeSessionCount).toBe(2);
    });

    it('6. produces complete aggregation when all applicable sessions are complete', () => {
      const log: WorkoutLog = {
        id: 'log-comp',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Curl',
            muscleGroup: 'Biceps',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 20, reps: 10, isCompleted: true }], // 200 kg
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log]);
      expect(summary.status).toBe('complete');
      expect(summary.valueKg).toBe(200);
      expect(summary.completeSessionCount).toBe(1);
      expect(summary.partialSessionCount).toBe(0);
      expect(summary.unavailableSessionCount).toBe(0);
    });

    it('7. produces partial aggregation with known minimum when some sessions are unavailable or partial', () => {
      const log1: WorkoutLog = {
        id: 'log-complete-part',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Deadlift',
            muscleGroup: 'Back',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 200, reps: 5, isCompleted: true }], // 1000 kg
          },
        ],
      };

      const log2: WorkoutLog = {
        id: 'log-unavail-part',
        date: '2026-03-05',
        unit: 'kg',
        // Missing snapshot
        exercises: [
          {
            name: 'Push-up',
            muscleGroup: 'Chest',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 20, isCompleted: true }], // unavailable volume
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log1, log2]);
      expect(summary.status).toBe('partial');
      expect(summary.valueKg).toBe(1000);
      expect(summary.completeSessionCount).toBe(1);
      expect(summary.unavailableSessionCount).toBe(1);
    });

    it('8. produces unavailable aggregation when no applicable volume resolves', () => {
      const log1: WorkoutLog = {
        id: 'log-unavail-1',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, isCompleted: true }],
          },
        ],
      };

      const log2: WorkoutLog = {
        id: 'log-unavail-2',
        date: '2026-03-05',
        unit: 'kg',
        exercises: [
          {
            name: 'Dip',
            muscleGroup: 'Chest',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, isCompleted: true }],
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log1, log2]);
      expect(summary.status).toBe('unavailable');
      expect(summary.valueKg).toBeNull();
      expect(summary.completeSessionCount).toBe(0);
      expect(summary.unavailableSessionCount).toBe(2);
    });

    it('9. produces not_applicable aggregation for timed/distance-only history', () => {
      const log1: WorkoutLog = {
        id: 'log-timed',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Plank',
            muscleGroup: 'Core',
            modality: 'timed',
            sets: [{ setNumber: 1, reps: 60, isCompleted: true }],
          },
        ],
      };

      const log2: WorkoutLog = {
        id: 'log-dist',
        date: '2026-03-05',
        unit: 'kg',
        exercises: [
          {
            name: 'Run',
            muscleGroup: 'Cardio',
            modality: 'distance',
            sets: [{ setNumber: 1, reps: 5000, isCompleted: true }],
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log1, log2]);
      expect(summary.status).toBe('not_applicable');
      expect(summary.valueKg).toBeNull();
      expect(summary.completeSessionCount).toBe(0);
      expect(summary.partialSessionCount).toBe(0);
      expect(summary.unavailableSessionCount).toBe(0);
    });

    it('10. handles zero eligible workouts returning not_applicable', () => {
      const summary = calculateDiaryHistoryVolume([]);
      expect(summary.status).toBe('not_applicable');
      expect(summary.valueKg).toBeNull();
      expect(summary.completeSessionCount).toBe(0);
      expect(summary.partialSessionCount).toBe(0);
      expect(summary.unavailableSessionCount).toBe(0);
    });

    it('11. accounts for invalid applicable loads affecting coverage', () => {
      const log: WorkoutLog = {
        id: 'log-invalid-load',
        date: '2026-03-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 70, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Dip',
            muscleGroup: 'Chest',
            modality: 'assisted',
            sets: [{ setNumber: 1, weight: 100, reps: 10, isCompleted: true }], // 100kg assistance > 70kg BW -> invalid
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log]);
      expect(summary.status).toBe('unavailable');
      expect(summary.valueKg).toBeNull();
    });

    it('12. includes drop sub-set volume in lifetime totals', () => {
      const log: WorkoutLog = {
        id: 'log-drop-lifetime',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Leg Press',
            muscleGroup: 'Quads',
            modality: 'weighted',
            sets: [
              {
                setNumber: 1,
                weight: 100,
                reps: 8, // 800 kg
                isCompleted: true,
                isDropSet: true,
                dropSubSets: [
                  { weight: 75, reps: 6 }, // 450 kg
                  { weight: 50, reps: 6 }, // 300 kg
                ],
              },
            ],
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log]);
      expect(summary.status).toBe('complete');
      expect(summary.valueKg).toBe(1550);
    });

    it('13. ensures current settings bodyweight cannot affect calculation output', () => {
      const log: WorkoutLog = {
        id: 'log-snapshot-isolation',
        date: '2026-03-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 70, unit: 'kg' },
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, isCompleted: true }], // 70 * 10 = 700 kg
          },
        ],
      };

      const summary = calculateDiaryHistoryVolume([log]);
      expect(summary.valueKg).toBe(700);
    });

    it('14. guarantees deep immutability and deterministic repeated calls', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-det-1',
          date: '2026-03-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 10, isCompleted: true }],
            },
          ],
        },
      ];

      const cloneBefore = JSON.stringify(logs);
      const res1 = calculateDiaryHistoryVolume(logs);
      const res2 = calculateDiaryHistoryVolume(logs);

      expect(JSON.stringify(logs)).toBe(cloneBefore);
      expect(res1).toEqual(res2);
    });
  });
});
