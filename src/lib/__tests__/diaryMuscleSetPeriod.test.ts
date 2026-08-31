/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  DiaryMusclePeriod,
  getNextDiaryMusclePeriod,
  getDiaryMusclePeriodRange,
  isWorkoutLogInDiaryMusclePeriod,
  filterWorkoutLogsByPeriod,
  generateDiaryMuscleSetStats,
  isParentWorkingSetEligible,
  normalizeDiaryMuscleGroup,
  getDiaryMusclePeriodAriaLabel,
  CANONICAL_DIARY_MUSCLE_GROUPS,
} from '../diaryMuscleSetPeriod';
import { WorkoutLog, ExerciseEntry, SetEntry } from '../../types';

describe('diaryMuscleSetPeriod pure calculation suite', () => {
  // 1. Cycle order
  describe('1. Cycle order', () => {
    it('cycles Lifetime -> This Week -> This Month -> This Year -> Lifetime', () => {
      expect(getNextDiaryMusclePeriod('lifetime')).toBe('this_week');
      expect(getNextDiaryMusclePeriod('this_week')).toBe('this_month');
      expect(getNextDiaryMusclePeriod('this_month')).toBe('this_year');
      expect(getNextDiaryMusclePeriod('this_year')).toBe('lifetime');
    });

    it('falls back safely to lifetime for invalid current value', () => {
      expect(getNextDiaryMusclePeriod('invalid' as any)).toBe('lifetime');
    });
  });

  // 2-5. Date boundaries & local calendar rules
  describe('2-5. Date range calculations and boundaries', () => {
    // Wednesday 19 August 2026 at 14:30:00 local time
    const fixedNowWed = new Date(2026, 7, 19, 14, 30, 0); // Month is 0-indexed (7 = Aug)

    it('2. Monday-start week-to-date includes Monday through Wednesday', () => {
      const range = getDiaryMusclePeriodRange('this_week', fixedNowWed);
      expect(range.startDateStr).toBe('2026-08-17'); // Monday 17 Aug
      expect(range.endDateStr).toBe('2026-08-19'); // Wednesday 19 Aug (today)
    });

    it('3. Sunday 16 August 2026 is excluded from the following week starting Monday 17 August', () => {
      const sunLog: WorkoutLog = { id: 'l1', date: '2026-08-16', unit: 'kg', exercises: [] };
      const monLog: WorkoutLog = { id: 'l2', date: '2026-08-17', unit: 'kg', exercises: [] };
      const wedLog: WorkoutLog = { id: 'l3', date: '2026-08-19', unit: 'kg', exercises: [] };

      expect(isWorkoutLogInDiaryMusclePeriod(sunLog, 'this_week', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod(monLog, 'this_week', fixedNowWed)).toBe(true);
      expect(isWorkoutLogInDiaryMusclePeriod(wedLog, 'this_week', fixedNowWed)).toBe(true);
    });

    it('4. Month-to-date bounds from 1st of current month through today', () => {
      const range = getDiaryMusclePeriodRange('this_month', fixedNowWed);
      expect(range.startDateStr).toBe('2026-08-01');
      expect(range.endDateStr).toBe('2026-08-19');

      const jul31Log: WorkoutLog = { id: 'l4', date: '2026-07-31', unit: 'kg', exercises: [] };
      const aug1Log: WorkoutLog = { id: 'l5', date: '2026-08-01', unit: 'kg', exercises: [] };

      expect(isWorkoutLogInDiaryMusclePeriod(jul31Log, 'this_month', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod(aug1Log, 'this_month', fixedNowWed)).toBe(true);
    });

    it('5. Year-to-date bounds from Jan 1 of current year through today', () => {
      const range = getDiaryMusclePeriodRange('this_year', fixedNowWed);
      expect(range.startDateStr).toBe('2026-01-01');
      expect(range.endDateStr).toBe('2026-08-19');

      const dec31PrevYear: WorkoutLog = { id: 'l6', date: '2025-12-31', unit: 'kg', exercises: [] };
      const jan1CurrYear: WorkoutLog = { id: 'l7', date: '2026-01-01', unit: 'kg', exercises: [] };

      expect(isWorkoutLogInDiaryMusclePeriod(dec31PrevYear, 'this_year', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod(jan1CurrYear, 'this_year', fixedNowWed)).toBe(true);
    });

    it('handles Sunday as current day: sets Monday 6 days prior as start of week', () => {
      const sundayNow = new Date(2026, 7, 23, 10, 0, 0); // Sun 23 Aug 2026
      const range = getDiaryMusclePeriodRange('this_week', sundayNow);
      expect(range.startDateStr).toBe('2026-08-17');
      expect(range.endDateStr).toBe('2026-08-23');
    });

    it('handles Monday as current day: sets Monday as both start and end of week', () => {
      const mondayNow = new Date(2026, 7, 17, 8, 0, 0); // Mon 17 Aug 2026
      const range = getDiaryMusclePeriodRange('this_week', mondayNow);
      expect(range.startDateStr).toBe('2026-08-17');
      expect(range.endDateStr).toBe('2026-08-17');
    });
  });

  // 6-8. Leap day, midnight, timezone offset safety
  describe('6-8. Calendar edge cases (leap day, midnight, offsets)', () => {
    it('6. Leap-day safety (2028-02-29 and 2024-02-29)', () => {
      const leapNow = new Date(2024, 1, 29, 20, 0, 0); // 29 Feb 2024 (Thursday)
      const feb29Log: WorkoutLog = { id: 'leap', date: '2024-02-29', unit: 'kg', exercises: [] };
      const mar1Log: WorkoutLog = { id: 'mar', date: '2024-03-01', unit: 'kg', exercises: [] };

      expect(isWorkoutLogInDiaryMusclePeriod(feb29Log, 'this_month', leapNow)).toBe(true);
      expect(isWorkoutLogInDiaryMusclePeriod(feb29Log, 'this_year', leapNow)).toBe(true);
      expect(isWorkoutLogInDiaryMusclePeriod(mar1Log, 'this_month', leapNow)).toBe(false);
    });

    it('7. Local-midnight safety (00:00:00 local time)', () => {
      const midnightNow = new Date(2026, 7, 19, 0, 0, 0, 0);
      const range = getDiaryMusclePeriodRange('this_week', midnightNow);
      expect(range.startDateStr).toBe('2026-08-17');
      expect(range.endDateStr).toBe('2026-08-19');

      const logToday: WorkoutLog = { id: 'midnight', date: '2026-08-19', unit: 'kg', exercises: [] };
      expect(isWorkoutLogInDiaryMusclePeriod(logToday, 'this_week', midnightNow)).toBe(true);
    });

    it('8. String comparison avoids UTC midnight shift issues', () => {
      const customNow = new Date(2026, 7, 19, 23, 59, 59);
      const logDated: WorkoutLog = { id: 't1', date: '2026-08-19', unit: 'kg', exercises: [] };
      expect(isWorkoutLogInDiaryMusclePeriod(logDated, 'this_month', customNow)).toBe(true);
    });
  });

  // 9-11. Future logs, lifetime scope, malformed dates
  describe('9-11. Scope & date validation safety', () => {
    const fixedNowWed = new Date(2026, 7, 19, 12, 0, 0);

    it('9. Future-dated logs are excluded from Week, Month and Year', () => {
      const futureTomorrow: WorkoutLog = { id: 'fut1', date: '2026-08-20', unit: 'kg', exercises: [] };
      const futureNextYear: WorkoutLog = { id: 'fut2', date: '2027-01-01', unit: 'kg', exercises: [] };

      expect(isWorkoutLogInDiaryMusclePeriod(futureTomorrow, 'this_week', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod(futureTomorrow, 'this_month', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod(futureTomorrow, 'this_year', fixedNowWed)).toBe(false);

      expect(isWorkoutLogInDiaryMusclePeriod(futureNextYear, 'this_week', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod(futureNextYear, 'this_month', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod(futureNextYear, 'this_year', fixedNowWed)).toBe(false);
    });

    it('10. Lifetime includes all logs regardless of date', () => {
      const pastLog: WorkoutLog = { id: 'p', date: '2020-01-01', unit: 'kg', exercises: [] };
      const futureLog: WorkoutLog = { id: 'f', date: '2030-01-01', unit: 'kg', exercises: [] };
      const missingDateLog: WorkoutLog = { id: 'm', date: '', unit: 'kg', exercises: [] };

      expect(isWorkoutLogInDiaryMusclePeriod(pastLog, 'lifetime', fixedNowWed)).toBe(true);
      expect(isWorkoutLogInDiaryMusclePeriod(futureLog, 'lifetime', fixedNowWed)).toBe(true);
      expect(isWorkoutLogInDiaryMusclePeriod(missingDateLog, 'lifetime', fixedNowWed)).toBe(true);
    });

    it('11. Malformed or missing dates fail safely without throwing', () => {
      expect(isWorkoutLogInDiaryMusclePeriod(null as any, 'this_week', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod({} as any, 'this_week', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod({ date: 'not-a-date' } as any, 'this_week', fixedNowWed)).toBe(false);
      expect(isWorkoutLogInDiaryMusclePeriod({ date: '2026/08/19' } as any, 'this_week', fixedNowWed)).toBe(false);
    });
  });

  // 12-21. Set eligibility rules
  describe('12-21. Working set eligibility rules', () => {
    const defaultEx: ExerciseEntry = { name: 'Bench Press', muscleGroup: 'Chest', sets: [] };

    it('12. Warm-up sets are strictly excluded', () => {
      const set: SetEntry = { setNumber: 1, weight: 60, reps: 5, isWarmup: true, isCompleted: true };
      expect(isParentWorkingSetEligible(defaultEx, set)).toBe(false);
    });

    it('13. Skipped sets and sets on skipped exercises are excluded', () => {
      const skippedSet: SetEntry = { setNumber: 1, weight: 100, reps: 5, isSkipped: true, isCompleted: true };
      expect(isParentWorkingSetEligible(defaultEx, skippedSet)).toBe(false);

      const skippedEx: ExerciseEntry = { ...defaultEx, isSkipped: true };
      const normalSet: SetEntry = { setNumber: 1, weight: 100, reps: 5, isCompleted: true };
      expect(isParentWorkingSetEligible(skippedEx, normalSet)).toBe(false);
    });

    it('14. Explicitly incomplete sets (isCompleted: false) are excluded', () => {
      const incompleteSet: SetEntry = { setNumber: 1, weight: 100, reps: 5, isCompleted: false };
      expect(isParentWorkingSetEligible(defaultEx, incompleteSet)).toBe(false);
    });

    it('15. Positive-weight/zero-rep placeholders are excluded', () => {
      const zeroRepSet: SetEntry = { setNumber: 1, weight: 100, reps: 0, isCompleted: true };
      expect(isParentWorkingSetEligible(defaultEx, zeroRepSet)).toBe(false);

      const nullRepSet: SetEntry = { setNumber: 1, weight: 100, reps: null, isCompleted: true };
      expect(isParentWorkingSetEligible(defaultEx, nullRepSet)).toBe(false);
    });

    it('16. Valid weighted working sets are included', () => {
      const validSet: SetEntry = { setNumber: 1, weight: 100, reps: 5, isCompleted: true };
      expect(isParentWorkingSetEligible(defaultEx, validSet)).toBe(true);
    });

    it('17. Valid bodyweight working sets are included (weight can be 0 or null)', () => {
      const bwEx: ExerciseEntry = { name: 'Pull-up', muscleGroup: 'Back', modality: 'bodyweight', sets: [] };
      const bwSet1: SetEntry = { setNumber: 1, weight: 0, reps: 10, isCompleted: true };
      const bwSet2: SetEntry = { setNumber: 2, reps: 8, isCompleted: true };
      const bwSet3: SetEntry = { setNumber: 3, weight: 15, reps: 6, isCompleted: true }; // Weighted pull-up

      expect(isParentWorkingSetEligible(bwEx, bwSet1)).toBe(true);
      expect(isParentWorkingSetEligible(bwEx, bwSet2)).toBe(true);
      expect(isParentWorkingSetEligible(bwEx, bwSet3)).toBe(true);
    });

    it('18. Valid assisted working sets are included', () => {
      const assistedEx: ExerciseEntry = { name: 'Assisted Dip', muscleGroup: 'Triceps', modality: 'assisted', sets: [] };
      const set: SetEntry = { setNumber: 1, weight: 25, reps: 8, isCompleted: true };
      expect(isParentWorkingSetEligible(assistedEx, set)).toBe(true);
    });

    it('19. Valid timed and distance modalities are handled properly', () => {
      const timedEx: ExerciseEntry = { name: 'Plank', muscleGroup: 'Abs', modality: 'timed', sets: [] };
      const timedSet: SetEntry = { setNumber: 1, weight: 60, isCompleted: true }; // 60 seconds
      expect(isParentWorkingSetEligible(timedEx, timedSet)).toBe(true);

      const distEx: ExerciseEntry = { name: 'Rowing', muscleGroup: 'Back', modality: 'distance', sets: [] };
      const distSet: SetEntry = { setNumber: 1, reps: 500, isCompleted: true }; // 500 meters
      expect(isParentWorkingSetEligible(distEx, distSet)).toBe(true);

      const loadedDistEx: ExerciseEntry = { name: 'Farmer Walk', muscleGroup: 'Forearms', modality: 'distance_loaded', sets: [] };
      const loadedDistSet: SetEntry = { setNumber: 1, weight: 32, reps: 50, isCompleted: true };
      expect(isParentWorkingSetEligible(loadedDistEx, loadedDistSet)).toBe(true);
    });

    it('20. Legacy valid working sets (isCompleted undefined) are included', () => {
      const legacySet: SetEntry = { setNumber: 1, weight: 100, reps: 5 };
      expect(isParentWorkingSetEligible(defaultEx, legacySet)).toBe(true);
    });

    it('21. Drop sets count as exactly 1 parent working set (sub-sets do not inflate set count)', () => {
      const dropEx: ExerciseEntry = {
        name: 'Leg Extension',
        muscleGroup: 'Quads',
        sets: [
          {
            setNumber: 1,
            weight: 80,
            reps: 10,
            isDropSet: true,
            isCompleted: true,
            dropSubSets: [
              { weight: 60, reps: 8 },
              { weight: 40, reps: 8 },
            ],
          },
        ],
      };

      const log: WorkoutLog = { id: 'drop-log', date: '2026-08-19', unit: 'kg', exercises: [dropEx] };
      const stats = generateDiaryMuscleSetStats([log], 'lifetime');
      expect(stats.totalSets).toBe(1);
      expect(stats.muscleSets.Quads).toBe(1);
    });
  });

  // 22-25. Muscle attribution and statistics generation
  describe('22-25. Muscle attribution & statistics generation', () => {
    it('22. Handles duplicate exercises independently and custom exercises', () => {
      const log: WorkoutLog = {
        id: 'dup-log',
        date: '2026-08-19',
        unit: 'kg',
        exercises: [
          {
            name: 'Overhead Press',
            muscleGroup: 'Delts',
            sets: [{ setNumber: 1, weight: 50, reps: 5, isCompleted: true }],
          },
          {
            name: 'Custom Lateral Raise',
            muscleGroup: 'Side Shoulders',
            sets: [{ setNumber: 1, weight: 12, reps: 12, isCompleted: true }],
          },
          {
            name: 'Overhead Press (Duplicate Entry)',
            muscleGroup: 'Delts',
            sets: [{ setNumber: 1, weight: 50, reps: 5, isCompleted: true }],
          },
        ],
      };

      const stats = generateDiaryMuscleSetStats([log], 'lifetime');
      expect(stats.totalSets).toBe(3);
      expect(stats.muscleSets.Delts).toBe(3); // 'Side Shoulders' maps to Delts
    });

    it('23. Uses primary muscle only across all 12 canonical groups', () => {
      expect(normalizeDiaryMuscleGroup('Front Deltoid')).toBe('Delts');
      expect(normalizeDiaryMuscleGroup('Upper Traps')).toBe('Traps');
      expect(normalizeDiaryMuscleGroup('Biceps Brachii')).toBe('Biceps');
      expect(normalizeDiaryMuscleGroup('Triceps Lateral Head')).toBe('Triceps');
      expect(normalizeDiaryMuscleGroup('Pectoralis Major')).toBe('Pecs');
      expect(normalizeDiaryMuscleGroup('Latissimus Dorsi')).toBe('Back');
      expect(normalizeDiaryMuscleGroup('Abdominals')).toBe('Abs');
      expect(normalizeDiaryMuscleGroup('Quadriceps')).toBe('Quads');
      expect(normalizeDiaryMuscleGroup('Hamstrings')).toBe('Hams');
      expect(normalizeDiaryMuscleGroup('Calves')).toBe('Calves');
      expect(normalizeDiaryMuscleGroup('Gluteus Maximus')).toBe('Glutes');
      expect(normalizeDiaryMuscleGroup('Forearm Flexors')).toBe('Forearms');
      expect(normalizeDiaryMuscleGroup('Unknown Non-Muscle')).toBeNull();
    });

    it('24. Unmapped muscle sets contribute to Total but not to any of the 12 grid cells', () => {
      const log: WorkoutLog = {
        id: 'unmapped-log',
        date: '2026-08-19',
        unit: 'kg',
        exercises: [
          {
            name: 'Custom Movement',
            muscleGroup: 'Mystery System',
            sets: [{ setNumber: 1, weight: 50, reps: 10, isCompleted: true }],
          },
          {
            name: 'No Muscle Group',
            muscleGroup: '',
            sets: [{ setNumber: 1, weight: 20, reps: 10, isCompleted: true }],
          },
        ],
      };

      const stats = generateDiaryMuscleSetStats([log], 'lifetime');
      expect(stats.totalSets).toBe(2);
      // All 12 canonical cells are 0
      CANONICAL_DIARY_MUSCLE_GROUPS.forEach(mg => {
        expect(stats.muscleSets[mg]).toBe(0);
      });
    });

    it('25. Deep immutability: source logs and exercise arrays are not mutated or sorted', () => {
      const log1: WorkoutLog = { id: '1', date: '2026-08-18', unit: 'kg', exercises: [] };
      const log2: WorkoutLog = { id: '2', date: '2026-08-19', unit: 'kg', exercises: [] };
      const logs = [log1, log2];
      const logsCopy = JSON.parse(JSON.stringify(logs));

      generateDiaryMuscleSetStats(logs, 'this_week');
      generateDiaryMuscleSetStats(logs, 'lifetime');

      expect(logs).toEqual(logsCopy);
      expect(logs[0].id).toBe('1');
      expect(logs[1].id).toBe('2');
    });
  });

  // 26. Before-and-after lifetime correction fixture
  describe('26. Before-and-after Lifetime correction fixture', () => {
    it('corrects warmups and zero-rep placeholders that the old logic counted', () => {
      const complexLog: WorkoutLog = {
        id: 'fixture-log',
        date: '2026-08-19',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Pecs',
            sets: [
              { setNumber: 1, weight: 60, reps: 5, isWarmup: true, isCompleted: true }, // Warmup (old counted, new excludes)
              { setNumber: 2, weight: 100, reps: 0, isCompleted: true }, // 0 reps placeholder (old counted because weight > 0, new excludes)
              { setNumber: 3, weight: 100, reps: 5, isCompleted: true }, // Valid working set (both count)
              { setNumber: 4, weight: 100, reps: 5, isCompleted: false }, // Explicit incomplete (both exclude)
            ],
          },
        ],
      };

      const stats = generateDiaryMuscleSetStats([complexLog], 'lifetime');
      expect(stats.totalSets).toBe(1); // Only setNumber 3 is an eligible working set
      expect(stats.muscleSets.Pecs).toBe(1);
    });
  });

  // Filter workout logs by period
  describe('filterWorkoutLogsByPeriod', () => {
    const fixedNowWed = new Date(2026, 7, 19, 14, 30, 0); // 19 Aug 2026
    const logs: WorkoutLog[] = [
      { id: '1', date: '2026-08-16', unit: 'kg', exercises: [] }, // Sun (before this_week)
      { id: '2', date: '2026-08-17', unit: 'kg', exercises: [] }, // Mon (in this_week, this_month, this_year)
      { id: '3', date: '2026-08-19', unit: 'kg', exercises: [] }, // Wed (today)
      { id: '4', date: '2026-07-31', unit: 'kg', exercises: [] }, // Prev month
      { id: '5', date: '2025-12-31', unit: 'kg', exercises: [] }, // Prev year
    ];

    it('returns empty array safely when logs is empty or not an array', () => {
      expect(filterWorkoutLogsByPeriod([], 'lifetime')).toEqual([]);
      expect(filterWorkoutLogsByPeriod(null as any, 'lifetime')).toEqual([]);
    });

    it('returns all logs for lifetime period', () => {
      const res = filterWorkoutLogsByPeriod(logs, 'lifetime', fixedNowWed);
      expect(res.map(l => l.id)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('returns only logs within this_week', () => {
      const res = filterWorkoutLogsByPeriod(logs, 'this_week', fixedNowWed);
      expect(res.map(l => l.id)).toEqual(['2', '3']);
    });

    it('returns only logs within this_month', () => {
      const res = filterWorkoutLogsByPeriod(logs, 'this_month', fixedNowWed);
      expect(res.map(l => l.id)).toEqual(['1', '2', '3']);
    });

    it('returns only logs within this_year', () => {
      const res = filterWorkoutLogsByPeriod(logs, 'this_year', fixedNowWed);
      expect(res.map(l => l.id)).toEqual(['1', '2', '3', '4']);
    });
  });

  // Accessible label generator
  describe('Aria label generator', () => {
    it('generates expected accessible announcement text for each cycle step', () => {
      expect(getDiaryMusclePeriodAriaLabel('lifetime', 'this_week')).toBe(
        'Journal summary period: Lifetime. Activate to show This Week.'
      );
      expect(getDiaryMusclePeriodAriaLabel('this_week', 'this_month')).toBe(
        'Journal summary period: This Week. Activate to show This Month.'
      );
      expect(getDiaryMusclePeriodAriaLabel('this_month', 'this_year')).toBe(
        'Journal summary period: This Month. Activate to show This Year.'
      );
      expect(getDiaryMusclePeriodAriaLabel('this_year', 'lifetime')).toBe(
        'Journal summary period: This Year. Activate to show Lifetime.'
      );
    });
  });
});
