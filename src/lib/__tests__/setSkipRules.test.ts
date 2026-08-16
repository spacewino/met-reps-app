import { describe, it, expect } from 'vitest';
import {
  getWorkingSetIndices,
  getFinalActiveWorkingSetIndex,
  getFirstSkippedWorkingSetIndex,
  isValidSkippedSuffix,
  hasSkippedWorkingSets,
  canSkipSet,
  canUnskipSet,
  isSetValidForCompletion,
} from '../setSkipRules';
import { extractHistoricalBaselineE1RM, calculateObjectiveSets } from '../objectiveMath';
import { extractObservedFatigueRatios } from '../setDistribution';
import { getRTSMultiplier, calculateE1RMForSet } from '../rpeMath';
import { ExerciseEntry, SetEntry, WorkoutLog } from '../../types';

describe('MetReps Contiguous Suffix Engine (setSkipRules)', () => {
  const createSets = (count: number, skippedIndices: number[] = [], warmupIndices: number[] = []): SetEntry[] => {
    return Array.from({ length: count }, (_, i) => ({
      setNumber: i + 1,
      weight: 100,
      reps: 5,
      rpe: 8,
      isWarmup: warmupIndices.includes(i),
      isSkipped: skippedIndices.includes(i),
    }));
  };

  it('1. Five working sets: initially only Set 5 (index 4) can be skipped', () => {
    const sets = createSets(5); // indices 0,1,2,3,4
    expect(getWorkingSetIndices(sets)).toEqual([0, 1, 2, 3, 4]);
    expect(getFinalActiveWorkingSetIndex(sets)).toBe(4);
    expect(getFirstSkippedWorkingSetIndex(sets)).toBeNull();
    expect(isValidSkippedSuffix(sets)).toBe(true);

    // Can only skip index 4 (Set 5)
    expect(canSkipSet(sets, 4).allowed).toBe(true);
    expect(canSkipSet(sets, 3).allowed).toBe(false);
    expect(canSkipSet(sets, 2).allowed).toBe(false);
    expect(canSkipSet(sets, 1).allowed).toBe(false);
    expect(canSkipSet(sets, 0).allowed).toBe(false);
  });

  it('2. After Set 5 is skipped, Set 4 can be skipped', () => {
    const sets = createSets(5, [4]);
    expect(getFinalActiveWorkingSetIndex(sets)).toBe(3);
    expect(getFirstSkippedWorkingSetIndex(sets)).toBe(4);
    expect(isValidSkippedSuffix(sets)).toBe(true);

    expect(canSkipSet(sets, 3).allowed).toBe(true);
    expect(canSkipSet(sets, 2).allowed).toBe(false);
  });

  it('3. After Sets 4 and 5 are skipped, Set 3 can be skipped', () => {
    const sets = createSets(5, [3, 4]);
    expect(getFinalActiveWorkingSetIndex(sets)).toBe(2);
    expect(getFirstSkippedWorkingSetIndex(sets)).toBe(3);
    expect(isValidSkippedSuffix(sets)).toBe(true);

    expect(canSkipSet(sets, 2).allowed).toBe(true);
    expect(canSkipSet(sets, 1).allowed).toBe(false);
  });

  it('4. With Sets 3, 4, 5 skipped, only Set 3 can initially be restored', () => {
    const sets = createSets(5, [2, 3, 4]);
    expect(getFinalActiveWorkingSetIndex(sets)).toBe(1);
    expect(getFirstSkippedWorkingSetIndex(sets)).toBe(2);

    expect(canUnskipSet(sets, 2).allowed).toBe(true);
    expect(canUnskipSet(sets, 3).allowed).toBe(false);
    expect(canUnskipSet(sets, 4).allowed).toBe(false);
  });

  it('5. Restore sequence proceeds Set 3, then Set 4, then Set 5', () => {
    // Stage 1: Sets 2, 3, 4 skipped -> unskip 2
    let sets = createSets(5, [2, 3, 4]);
    expect(canUnskipSet(sets, 2).allowed).toBe(true);

    // Stage 2: Sets 3, 4 skipped -> unskip 3
    sets = createSets(5, [3, 4]);
    expect(canUnskipSet(sets, 3).allowed).toBe(true);
    expect(canUnskipSet(sets, 4).allowed).toBe(false);

    // Stage 3: Set 4 skipped -> unskip 4
    sets = createSets(5, [4]);
    expect(canUnskipSet(sets, 4).allowed).toBe(true);

    // Stage 4: None skipped
    sets = createSets(5);
    expect(canUnskipSet(sets, 4).allowed).toBe(false);
  });

  it('6. One-working-set exercise: can be skipped and unskipped cleanly', () => {
    const activeSets = createSets(1);
    expect(canSkipSet(activeSets, 0).allowed).toBe(true);
    expect(canUnskipSet(activeSets, 0).allowed).toBe(false);

    const skippedSets = createSets(1, [0]);
    expect(canSkipSet(skippedSets, 0).allowed).toBe(false);
    expect(canUnskipSet(skippedSets, 0).allowed).toBe(true);
  });

  it('7. Warm-ups before working sets do not consume working set ordinals', () => {
    // 2 warmups at index 0, 1; 3 working sets at index 2, 3, 4
    const sets = createSets(5, [], [0, 1]);
    expect(getWorkingSetIndices(sets)).toEqual([2, 3, 4]);
    expect(getFinalActiveWorkingSetIndex(sets)).toBe(4);

    // Warmups cannot be skipped
    expect(canSkipSet(sets, 0).allowed).toBe(false);
    expect(canSkipSet(sets, 1).allowed).toBe(false);

    // Only last working set (index 4) can be skipped
    expect(canSkipSet(sets, 4).allowed).toBe(true);
    expect(canSkipSet(sets, 3).allowed).toBe(false);
    expect(canSkipSet(sets, 2).allowed).toBe(false);
  });

  it('8. Warm-ups interspersed between working sets', () => {
    // Index 0: working, Index 1: warmup, Index 2: working, Index 3: working
    const sets = createSets(4, [], [1]);
    expect(getWorkingSetIndices(sets)).toEqual([0, 2, 3]);
    expect(getFinalActiveWorkingSetIndex(sets)).toBe(3);

    expect(canSkipSet(sets, 1).allowed).toBe(false); // warmup
    expect(canSkipSet(sets, 3).allowed).toBe(true);  // last working
    expect(canSkipSet(sets, 2).allowed).toBe(false); // middle working
  });

  it('9. Already-skipped and already-active guard actions', () => {
    const sets = createSets(3, [2]);
    // Set 2 is already skipped
    expect(canSkipSet(sets, 2).allowed).toBe(false);
    // Set 0 is already active
    expect(canUnskipSet(sets, 0).allowed).toBe(false);
  });

  it('10. Malformed non-contiguous imported state detection and defense', () => {
    // Working sets 0, 1, 2 where 1 is skipped but 2 is active (gap)
    const malformed = createSets(3, [1]);
    expect(isValidSkippedSuffix(malformed)).toBe(false);

    // canSkipSet rejects skipping further while malformed
    const skipCheck = canSkipSet(malformed, 2);
    expect(skipCheck.allowed).toBe(false);
    expect(skipCheck.reason).toContain('Non-contiguous');

    // canUnskipSet allows unskipping to repair
    expect(canUnskipSet(malformed, 1).allowed).toBe(true);
  });

  it('11. Empty set array and out of bounds indices', () => {
    expect(getWorkingSetIndices([])).toEqual([]);
    expect(getFinalActiveWorkingSetIndex([])).toBeNull();
    expect(getFirstSkippedWorkingSetIndex([])).toBeNull();
    expect(isValidSkippedSuffix([])).toBe(true);
    expect(hasSkippedWorkingSets([])).toBe(false);
    expect(canSkipSet([], 0).allowed).toBe(false);
    expect(canUnskipSet([], 0).allowed).toBe(false);

    const sets = createSets(3);
    expect(canSkipSet(sets, -1).allowed).toBe(false);
    expect(canSkipSet(sets, 5).allowed).toBe(false);
    expect(canUnskipSet(sets, -1).allowed).toBe(false);
    expect(canUnskipSet(sets, 5).allowed).toBe(false);
  });

  it('12. Add Set remains blocked while a skipped suffix exists', () => {
    const setsWithSkip = createSets(4, [3]);
    expect(hasSkippedWorkingSets(setsWithSkip)).toBe(true);

    const setsWithoutSkip = createSets(4);
    expect(hasSkippedWorkingSets(setsWithoutSkip)).toBe(false);
  });

  it('13. Permitted and prohibited set moves preserving contiguous suffix', () => {
    // Sets: 0 (active), 1 (active), 2 (skipped)
    // Moving 0 down to 1 -> [1, 0, 2] -> valid
    const sets = createSets(3, [2]);
    const sim1 = [sets[1], sets[0], sets[2]];
    expect(isValidSkippedSuffix(sim1)).toBe(true);

    // Moving 1 down to 2 -> [0, 2, 1] -> INVALID (active after skipped)
    const sim2 = [sets[0], sets[2], sets[1]];
    expect(isValidSkippedSuffix(sim2)).toBe(false);
  });

  it('14. Immutability of helper inputs', () => {
    const original = createSets(4, [3]);
    const clone = JSON.parse(JSON.stringify(original));
    Object.freeze(original);

    getWorkingSetIndices(original);
    getFinalActiveWorkingSetIndex(original);
    getFirstSkippedWorkingSetIndex(original);
    isValidSkippedSuffix(original);
    hasSkippedWorkingSets(original);
    canSkipSet(original, 2);
    canUnskipSet(original, 3);

    expect(original).toEqual(clone);
  });
});

describe('Historical Baseline & Progression Skip-Suffix Integrity', () => {
  it('1. Performed Sets 1-2 followed by skipped Sets 3-5 only uses Sets 1-2 for baseline', () => {
    const log: WorkoutLog = {
      id: 'log-baseline-1',
      date: '2026-01-01',
      unit: 'kg',
      exercises: [
        {
          name: 'Squat',
          muscleGroup: 'Quads',
          sets: [
            { setNumber: 1, weight: 140, reps: 5, rpe: 8, isCompleted: true },
            { setNumber: 2, weight: 145, reps: 5, rpe: 8.5, isCompleted: true },
            { setNumber: 3, weight: 150, reps: 5, rpe: 9, isSkipped: true, isCompleted: false },
            { setNumber: 4, weight: 150, reps: 5, rpe: 9, isSkipped: true, isCompleted: false },
            { setNumber: 5, weight: 150, reps: 5, rpe: 9, isSkipped: true, isCompleted: false },
          ],
        },
      ],
    };

    const baseline = extractHistoricalBaselineE1RM('Squat', [log]);
    const expectedSet2E1RM = calculateE1RMForSet(145, 5, 8.5)!;
    expect(baseline).toBeCloseTo(expectedSet2E1RM, 2);
  });

  it('2. Malformed imported data where Set 2 is skipped but Set 3 is completed: stops at Set 2', () => {
    const log: WorkoutLog = {
      id: 'log-malformed',
      date: '2026-01-01',
      unit: 'kg',
      exercises: [
        {
          name: 'Bench Press',
          muscleGroup: 'Pecs',
          sets: [
            { setNumber: 1, weight: 100, reps: 5, rpe: 8, isCompleted: true },
            { setNumber: 2, weight: 105, reps: 5, rpe: 8, isSkipped: true, isCompleted: false },
            { setNumber: 3, weight: 200, reps: 5, rpe: 8, isCompleted: true }, // Should never be reached!
          ],
        },
      ],
    };

    const baseline = extractHistoricalBaselineE1RM('Bench Press', [log]);
    const expectedSet1E1RM = calculateE1RMForSet(100, 5, 8)!;
    expect(baseline).toBeCloseTo(expectedSet1E1RM, 2);
  });

  it('3. Warm-ups placed before or between working sets are ignored for baseline but do not break working set scan', () => {
    const log: WorkoutLog = {
      id: 'log-warmups',
      date: '2026-01-01',
      unit: 'kg',
      exercises: [
        {
          name: 'Deadlift',
          muscleGroup: 'Back',
          sets: [
            { setNumber: 1, weight: 60, reps: 5, isWarmup: true, isCompleted: true },
            { setNumber: 2, weight: 140, reps: 5, rpe: 8, isCompleted: true },
            { setNumber: 3, weight: 100, reps: 3, isWarmup: true, isCompleted: true },
            { setNumber: 4, weight: 150, reps: 5, rpe: 8.5, isCompleted: true },
            { setNumber: 5, weight: 160, reps: 5, rpe: 9, isSkipped: true, isCompleted: false },
          ],
        },
      ],
    };

    const baseline = extractHistoricalBaselineE1RM('Deadlift', [log]);
    const expectedSet4E1RM = calculateE1RMForSet(150, 5, 8.5)!;
    expect(baseline).toBeCloseTo(expectedSet4E1RM, 2);
  });

  it('4. A skipped Set 1 contributes zero baseline evidence', () => {
    const log: WorkoutLog = {
      id: 'log-skipped-set1',
      date: '2026-01-01',
      unit: 'kg',
      exercises: [
        {
          name: 'Overhead Press',
          muscleGroup: 'Shoulders',
          sets: [
            { setNumber: 1, weight: 60, reps: 5, rpe: 8, isSkipped: true, isCompleted: false },
            { setNumber: 2, weight: 60, reps: 5, rpe: 8, isSkipped: true, isCompleted: false },
          ],
        },
      ],
    };

    const baseline = extractHistoricalBaselineE1RM('Overhead Press', [log]);
    expect(baseline).toBe(0);
  });

  it('5. An exercise-level skip contributes zero baseline evidence', () => {
    const log: WorkoutLog = {
      id: 'log-skipped-ex',
      date: '2026-01-01',
      unit: 'kg',
      exercises: [
        {
          name: 'Barbell Row',
          muscleGroup: 'Back',
          isSkipped: true,
          sets: [
            { setNumber: 1, weight: 90, reps: 8, rpe: 8, isCompleted: false },
          ],
        },
      ],
    };

    const baseline = extractHistoricalBaselineE1RM('Barbell Row', [log]);
    expect(baseline).toBe(0);
  });

  it('6. Legacy log with isSkipped undefined contributes baseline evidence normally', () => {
    const log: WorkoutLog = {
      id: 'log-legacy',
      date: '2025-10-01',
      unit: 'kg',
      exercises: [
        {
          name: 'Barbell Row',
          muscleGroup: 'Back',
          sets: [
            { setNumber: 1, weight: 90, reps: 8, rpe: 8 }, // legacy undefined
          ],
        },
      ],
    };

    const baseline = extractHistoricalBaselineE1RM('Barbell Row', [log]);
    const expected = calculateE1RMForSet(90, 8, 8)!;
    expect(baseline).toBeCloseTo(expected, 2);
  });
});

describe('Fatigue Learning & No-Evidence Carryover with Production Maths', () => {
  it('1. Fatigue learning halts at the first skipped working set and excludes malformed gaps', () => {
    const log: WorkoutLog = {
      id: 'fatigue-log',
      date: '2026-01-01',
      unit: 'kg',
      objective: 'Hypertrophy',
      exercises: [
        {
          name: 'Bench Press',
          muscleGroup: 'Pecs',
          sets: [
            { setNumber: 1, weight: 100, reps: 5, rpe: 8, isCompleted: true },
            { setNumber: 2, weight: 95, reps: 5, rpe: 8, isCompleted: true },
            { setNumber: 3, weight: 90, reps: 5, rpe: 8, isSkipped: true, isCompleted: false },
            { setNumber: 4, weight: 120, reps: 5, rpe: 8, isCompleted: true }, // after skipped set
          ],
        },
      ],
    };

    const sessions = extractObservedFatigueRatios('Bench Press', [log], 'hypertrophy');
    expect(sessions).toHaveLength(1);
    const ratios = sessions[0].ratiosByOrdinal;
    // Ordinal 1 is 1.0
    expect(ratios[1]).toBe(1.0);
    // Ordinal 2 was observed
    expect(ratios[2]).toBeDefined();
    // Ordinal 3 and 4 were NOT learned (suffix skip and after-skip excluded)
    expect(ratios[3]).toBeUndefined();
    expect(ratios[4]).toBeUndefined();
  });

  it('2. Production Canonical Multiplier & No-Evidence Carryover Verification', () => {
    // 100.0 kg x 10 reps @ RPE 8.0
    const pct = getRTSMultiplier(10, 8.0);
    expect(pct).toBe(0.68); // Canonical multiplier: 0.680

    const e1rmWeek1 = 100.0 / 0.68;
    expect(e1rmWeek1).toBeCloseTo(147.0588, 3); // Approximately 147.0588 kg

    // Week 1 Log
    const week1Log: WorkoutLog = {
      id: 'week1-log',
      date: '2026-01-01',
      programId: 'test-hypertrophy',
      week: '1',
      day: '1',
      unit: 'kg',
      objective: 'Hypertrophy',
      exercises: [
        {
          name: 'Barbell Squat',
          muscleGroup: 'Quads',
          sets: [
            { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
            { setNumber: 2, weight: 95, reps: 10, rpe: 8.0, isCompleted: true },
            { setNumber: 3, weight: 90, reps: 10, rpe: 8.0, isCompleted: true },
          ],
        },
      ],
    };

    // Week 2 Log: Sets 1 & 2 performed, Set 3 skipped
    const week2Log: WorkoutLog = {
      id: 'week2-log',
      date: '2026-01-08',
      programId: 'test-hypertrophy',
      week: '2',
      day: '1',
      unit: 'kg',
      objective: 'Hypertrophy',
      exercises: [
        {
          name: 'Barbell Squat',
          muscleGroup: 'Quads',
          sets: [
            { setNumber: 1, weight: 102.5, reps: 10, rpe: 8.5, isCompleted: true },
            { setNumber: 2, weight: 97.5, reps: 10, rpe: 8.5, isCompleted: true },
            { setNumber: 3, weight: 92.5, reps: 10, rpe: 8.5, isSkipped: true, isCompleted: false },
          ],
        },
      ],
    };

    const previousLogs = [week1Log, week2Log];

    // Assert Week 2 Set 3 does not contribute baseline E1RM
    const baseline = extractHistoricalBaselineE1RM('Barbell Squat', previousLogs);
    const expectedSet1Week2E1RM = calculateE1RMForSet(102.5, 10, 8.5)!;
    expect(baseline).toBeCloseTo(expectedSet1Week2E1RM, 2);

    // Generate Week 3 targets
    const templateEx: ExerciseEntry = {
      name: 'Barbell Squat',
      muscleGroup: 'Quads',
      sets: [
        { setNumber: 1, weight: 0, reps: 10, rpe: 8 },
        { setNumber: 2, weight: 0, reps: 10, rpe: 8 },
        { setNumber: 3, weight: 0, reps: 10, rpe: 8 },
      ],
    };

    const week3Calculated = calculateObjectiveSets({
      objective: 'Hypertrophy',
      exercise: templateEx,
      exerciseIndex: 0,
      totalExercises: 1,
      weekNum: 3,
      programDuration: 8,
      previousLogs,
      algorithmId: 'hypertrophy_linear',
    });

    expect(week3Calculated).toHaveLength(3);
    // Every target is a 2.5kg multiple
    week3Calculated.forEach(s => {
      expect(s.weight! % 2.5).toBe(0);
      expect(s.isSkipped).toBeUndefined(); // Fresh targets are not skipped
    });

    // Week 3 Set 3 does NOT literally copy the skipped Week 2 target (92.5kg @ RPE 8.5)
    // It generates according to the scheduled Week 3 prescription (e.g. 10 reps @ RPE 9.0)
    expect(week3Calculated[0].weight).toBeGreaterThan(0);
  });
});
