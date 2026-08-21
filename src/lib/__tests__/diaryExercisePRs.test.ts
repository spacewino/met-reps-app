import { describe, it, expect } from 'vitest';
import { generateExercisePRMap } from '../diaryExercisePRs';
import { WorkoutLog, ExerciseEntry, SetEntry } from '../../types';

function createDummySet(overrides: Partial<SetEntry> = {}): SetEntry {
  return {
    setNumber: 1,
    weight: 100,
    reps: 5,
    rpe: 8.0,
    isCompleted: true,
    isWarmup: false,
    isSkipped: false,
    ...overrides,
  };
}

function createDummyExercise(overrides: Partial<ExerciseEntry> = {}): ExerciseEntry {
  return {
    name: 'Bench Press',
    muscleGroup: 'Chest',
    movementCategory: 'compound',
    modality: 'weighted',
    isSkipped: false,
    sets: [createDummySet()],
    ...overrides,
  };
}

function createDummyLog(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return {
    id: 'log-1700000000000',
    date: '2025-01-15',
    unit: 'kg',
    exercises: [createDummyExercise()],
    ...overrides,
  };
}

describe('Diary Exercise PR Engine (generateExercisePRMap)', () => {
  it('identifies baseline PRs on first exposure', () => {
    const log = createDummyLog({
      id: 'log-1',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Bench Press',
          sets: [createDummySet({ setNumber: 1, weight: 100, reps: 5 })],
        }),
      ],
    });

    const prMap = generateExercisePRMap([log]);
    expect(prMap['log-1_0_0']).toBe(true);
  });

  it('correctly compares chronological logs and marks only record-breaking sets as PRs', () => {
    const log1 = createDummyLog({
      id: 'log-1',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Bench Press',
          sets: [createDummySet({ setNumber: 1, weight: 100, reps: 5 })], // e1RM = 100 * (1 + 5/30) = 116.67 kg
        }),
      ],
    });

    const log2 = createDummyLog({
      id: 'log-2',
      date: '2025-01-08',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Bench Press',
          sets: [
            createDummySet({ setNumber: 1, weight: 100, reps: 4 }), // e1RM = 113.33 kg -> Not PR
            createDummySet({ setNumber: 2, weight: 105, reps: 5 }), // e1RM = 105 * (1 + 5/30) = 122.5 kg -> PR
          ],
        }),
      ],
    });

    const prMap = generateExercisePRMap([log1, log2]);
    expect(prMap['log-1_0_0']).toBe(true);
    expect(prMap['log-2_0_0']).toBeUndefined();
    expect(prMap['log-2_0_1']).toBe(true);
  });

  it('handles bodyweight modalities with bodyweightSnapshot', () => {
    const log1 = createDummyLog({
      id: 'log-1',
      date: '2025-01-01',
      unit: 'kg',
      bodyweightSnapshot: { value: 80, unit: 'kg' },
      exercises: [
        createDummyExercise({
          name: 'Pull-up',
          modality: 'bodyweight',
          sets: [createDummySet({ setNumber: 1, weight: 0, reps: 10 })], // e1RM = 80 * (1 + 10/30) = 106.67 kg
        }),
      ],
    });

    const log2 = createDummyLog({
      id: 'log-2',
      date: '2025-01-08',
      unit: 'kg',
      bodyweightSnapshot: { value: 80, unit: 'kg' },
      exercises: [
        createDummyExercise({
          name: 'Pull-up',
          modality: 'bodyweight',
          sets: [
            createDummySet({ setNumber: 1, weight: 0, reps: 8 }), // Not PR
            createDummySet({ setNumber: 2, weight: 0, reps: 12 }), // PR (e1RM = 80 * 1.4 = 112 kg)
          ],
        }),
      ],
    });

    const prMap = generateExercisePRMap([log1, log2]);
    expect(prMap['log-1_0_0']).toBe(true);
    expect(prMap['log-2_0_0']).toBeUndefined();
    expect(prMap['log-2_0_1']).toBe(true);
  });

  it('handles assisted modalities where lower assistance equals higher effective load', () => {
    const log1 = createDummyLog({
      id: 'log-1',
      date: '2025-01-01',
      unit: 'kg',
      bodyweightSnapshot: { value: 80, unit: 'kg' },
      exercises: [
        createDummyExercise({
          name: 'Assisted Dip',
          modality: 'assisted',
          sets: [createDummySet({ setNumber: 1, weight: 20, reps: 5 })], // effective load = 80 - 20 = 60 kg; e1RM = 60 * (1 + 5/30) = 70 kg
        }),
      ],
    });

    const log2 = createDummyLog({
      id: 'log-2',
      date: '2025-01-08',
      unit: 'kg',
      bodyweightSnapshot: { value: 80, unit: 'kg' },
      exercises: [
        createDummyExercise({
          name: 'Assisted Dip',
          modality: 'assisted',
          sets: [
            createDummySet({ setNumber: 1, weight: 25, reps: 5 }), // effective load = 55 kg -> Not PR
            createDummySet({ setNumber: 2, weight: 15, reps: 5 }), // effective load = 65 kg -> e1RM = 65 * 1.1667 = 75.83 kg -> PR
          ],
        }),
      ],
    });

    const prMap = generateExercisePRMap([log1, log2]);
    expect(prMap['log-1_0_0']).toBe(true);
    expect(prMap['log-2_0_0']).toBeUndefined();
    expect(prMap['log-2_0_1']).toBe(true);
  });

  it('handles cross-unit comparison seamlessly (kg vs lb)', () => {
    const log1 = createDummyLog({
      id: 'log-1',
      date: '2025-01-01',
      unit: 'lb',
      exercises: [
        createDummyExercise({
          name: 'Overhead Press',
          sets: [createDummySet({ setNumber: 1, weight: 135, reps: 5 })], // 135 lb = 61.235 kg; e1RM = 71.44 kg
        }),
      ],
    });

    const log2 = createDummyLog({
      id: 'log-2',
      date: '2025-01-08',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Overhead Press',
          sets: [
            createDummySet({ setNumber: 1, weight: 60, reps: 5 }), // 60 kg (e1RM = 70 kg) -> Not PR
            createDummySet({ setNumber: 2, weight: 65, reps: 5 }), // 65 kg (e1RM = 75.83 kg) -> PR
          ],
        }),
      ],
    });

    const prMap = generateExercisePRMap([log1, log2]);
    expect(prMap['log-1_0_0']).toBe(true);
    expect(prMap['log-2_0_0']).toBeUndefined();
    expect(prMap['log-2_0_1']).toBe(true);
  });

  it('ignores warmups, skipped sets, and uncompleted sets', () => {
    const log = createDummyLog({
      id: 'log-1',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Deadlift',
          sets: [
            createDummySet({ setNumber: 1, weight: 200, reps: 5, isWarmup: true }),
            createDummySet({ setNumber: 2, weight: 200, reps: 5, isSkipped: true }),
            createDummySet({ setNumber: 3, weight: 200, reps: 5, isCompleted: false }),
            createDummySet({ setNumber: 4, weight: 150, reps: 5, isCompleted: true }),
          ],
        }),
      ],
    });

    const prMap = generateExercisePRMap([log]);
    expect(prMap['log-1_0_0']).toBeUndefined();
    expect(prMap['log-1_0_1']).toBeUndefined();
    expect(prMap['log-1_0_2']).toBeUndefined();
    expect(prMap['log-1_0_3']).toBe(true);
  });

  // Direct AS-5C-R2B Chronology & Duplicate Safety Tests

  it('1. sorts same-day epoch-like IDs chronologically even when input array is reversed', () => {
    const logEarlier = createDummyLog({
      id: '1700000000000',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Squat',
          sets: [createDummySet({ setNumber: 1, weight: 100, reps: 5 })], // 116.67 kg
        }),
      ],
    });

    const logLater = createDummyLog({
      id: '1700000005000',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Squat',
          sets: [createDummySet({ setNumber: 1, weight: 110, reps: 5 })], // 128.33 kg
        }),
      ],
    });

    // Reversed input array order
    const prMap = generateExercisePRMap([logLater, logEarlier]);
    expect(prMap['1700000000000_0_0']).toBe(true); // Baseline PR
    expect(prMap['1700000005000_0_0']).toBe(true); // Exceeds earlier same-day best
  });

  it('2. sorts log-<timestamp> IDs chronologically on same calendar date', () => {
    const logEarlier = createDummyLog({
      id: 'log-1700000001000',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Bench Press',
          sets: [createDummySet({ setNumber: 1, weight: 100, reps: 5 })],
        }),
      ],
    });

    const logLater = createDummyLog({
      id: 'log-1700000009000',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Bench Press',
          sets: [createDummySet({ setNumber: 1, weight: 90, reps: 5 })], // lower weight -> not PR
        }),
      ],
    });

    // Input reversed
    const prMap = generateExercisePRMap([logLater, logEarlier]);
    expect(prMap['log-1700000001000_0_0']).toBe(true);
    expect(prMap['log-1700000009000_0_0']).toBeUndefined();
  });

  it('3. uses stable original array order for arbitrary same-day string IDs', () => {
    const logMorning = createDummyLog({
      id: 'morning-session',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Deadlift',
          sets: [createDummySet({ setNumber: 1, weight: 150, reps: 5 })],
        }),
      ],
    });

    const logEvening = createDummyLog({
      id: 'evening-session',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Deadlift',
          sets: [createDummySet({ setNumber: 1, weight: 140, reps: 5 })],
        }),
      ],
    });

    const prMap = generateExercisePRMap([logMorning, logEvening]);
    expect(prMap['morning-session_0_0']).toBe(true);
    expect(prMap['evening-session_0_0']).toBeUndefined();
  });

  it('4. earlier same-day performance affects the later log', () => {
    const log1 = createDummyLog({
      id: 'log-1700000001000',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Overhead Press',
          sets: [createDummySet({ setNumber: 1, weight: 80, reps: 5 })],
        }),
      ],
    });

    const log2 = createDummyLog({
      id: 'log-1700000002000',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Overhead Press',
          sets: [createDummySet({ setNumber: 1, weight: 70, reps: 5 })],
        }),
      ],
    });

    const prMap = generateExercisePRMap([log1, log2]);
    expect(prMap['log-1700000001000_0_0']).toBe(true);
    expect(prMap['log-1700000002000_0_0']).toBeUndefined();
  });

  it('5. later same-day performance does not affect the earlier log', () => {
    const log1 = createDummyLog({
      id: 'log-1700000001000',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Overhead Press',
          sets: [createDummySet({ setNumber: 1, weight: 60, reps: 5 })],
        }),
      ],
    });

    const log2 = createDummyLog({
      id: 'log-1700000002000',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Overhead Press',
          sets: [createDummySet({ setNumber: 1, weight: 80, reps: 5 })],
        }),
      ],
    });

    const prMap = generateExercisePRMap([log1, log2]);
    expect(prMap['log-1700000001000_0_0']).toBe(true); // Was PR when performed
    expect(prMap['log-1700000002000_0_0']).toBe(true); // Exceeded previous PR
  });

  it('6. future-day logs do not affect earlier badges', () => {
    const pastLog = createDummyLog({
      id: 'past-log',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Leg Press',
          sets: [createDummySet({ setNumber: 1, weight: 200, reps: 10 })],
        }),
      ],
    });

    const futureLog = createDummyLog({
      id: 'future-log',
      date: '2025-01-15',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Leg Press',
          sets: [createDummySet({ setNumber: 1, weight: 300, reps: 10 })],
        }),
      ],
    });

    const prMap = generateExercisePRMap([pastLog, futureLog]);
    expect(prMap['past-log_0_0']).toBe(true);
    expect(prMap['future-log_0_0']).toBe(true);
  });

  it('7. duplicate IDs are entirely omitted from the PR map', () => {
    const dup1 = createDummyLog({
      id: 'duplicate-workout-id',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Row',
          sets: [createDummySet({ setNumber: 1, weight: 80, reps: 5 })],
        }),
      ],
    });

    const dup2 = createDummyLog({
      id: 'duplicate-workout-id',
      date: '2025-01-02',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Row',
          sets: [createDummySet({ setNumber: 1, weight: 85, reps: 5 })],
        }),
      ],
    });

    const prMap = generateExercisePRMap([dup1, dup2]);
    expect(prMap['duplicate-workout-id_0_0']).toBeUndefined();
  });

  it('8. unique IDs remain unaffected when duplicate IDs also exist in history', () => {
    const dup1 = createDummyLog({
      id: 'dup-id',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Row',
          sets: [createDummySet({ setNumber: 1, weight: 80, reps: 5 })],
        }),
      ],
    });

    const dup2 = createDummyLog({
      id: 'dup-id',
      date: '2025-01-02',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Row',
          sets: [createDummySet({ setNumber: 1, weight: 85, reps: 5 })],
        }),
      ],
    });

    const uniqueLog = createDummyLog({
      id: 'unique-id',
      date: '2025-01-03',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Row',
          sets: [createDummySet({ setNumber: 1, weight: 90, reps: 5 })],
        }),
      ],
    });

    const prMap = generateExercisePRMap([dup1, dup2, uniqueLog]);
    expect(prMap['dup-id_0_0']).toBeUndefined();
    expect(prMap['unique-id_0_0']).toBe(true);
  });

  it('9. invalid-date entries do not contaminate valid history', () => {
    const invalidLog = createDummyLog({
      id: 'invalid-log-entry',
      date: 'invalid-date-string',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Bench Press',
          sets: [createDummySet({ setNumber: 1, weight: 500, reps: 5 })],
        }),
      ],
    });

    const validLog = createDummyLog({
      id: 'valid-log-entry',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Bench Press',
          sets: [createDummySet({ setNumber: 1, weight: 100, reps: 5 })],
        }),
      ],
    });

    const prMap = generateExercisePRMap([invalidLog, validLog]);
    expect(prMap['valid-log-entry_0_0']).toBe(true);
    expect(prMap['invalid-log-entry_0_0']).toBeUndefined();
  });

  it('10. bodyweight and assisted chronology uses canonical effective load', () => {
    const log1 = createDummyLog({
      id: 'log-bw-1',
      date: '2025-01-01',
      unit: 'kg',
      bodyweightSnapshot: { value: 80, unit: 'kg' },
      exercises: [
        createDummyExercise({
          name: 'Chin-up',
          modality: 'bodyweight',
          sets: [createDummySet({ setNumber: 1, weight: 0, reps: 10 })], // effective load = 80kg -> e1RM = 106.67kg
        }),
      ],
    });

    const log2 = createDummyLog({
      id: 'log-assisted-2',
      date: '2025-01-08',
      unit: 'kg',
      bodyweightSnapshot: { value: 80, unit: 'kg' },
      exercises: [
        createDummyExercise({
          name: 'Chin-up',
          modality: 'assisted',
          sets: [createDummySet({ setNumber: 1, weight: 20, reps: 10 })], // effective load = 60kg -> e1RM = 80kg -> not PR
        }),
      ],
    });

    const log3 = createDummyLog({
      id: 'log-assisted-3',
      date: '2025-01-15',
      unit: 'kg',
      bodyweightSnapshot: { value: 80, unit: 'kg' },
      exercises: [
        createDummyExercise({
          name: 'Chin-up',
          modality: 'assisted',
          sets: [createDummySet({ setNumber: 1, weight: 5, reps: 15 })], // effective load = 75kg -> e1RM = 75 * 1.5 = 112.5kg -> PR
        }),
      ],
    });

    const prMap = generateExercisePRMap([log1, log2, log3]);
    expect(prMap['log-bw-1_0_0']).toBe(true);
    expect(prMap['log-assisted-2_0_0']).toBeUndefined();
    expect(prMap['log-assisted-3_0_0']).toBe(true);
  });

  it('11. cross-unit equivalent loads do not create a PR', () => {
    const log1 = createDummyLog({
      id: 'log-kg-base',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Squat',
          sets: [createDummySet({ setNumber: 1, weight: 100, reps: 5 })], // 100 kg -> e1RM = 116.67 kg
        }),
      ],
    });

    const log2 = createDummyLog({
      id: 'log-lb-equiv',
      date: '2025-01-08',
      unit: 'lb',
      exercises: [
        createDummyExercise({
          name: 'Squat',
          sets: [createDummySet({ setNumber: 1, weight: 220.46226218, reps: 5 })], // exact 100 kg equivalent -> e1RM = 116.67 kg
        }),
      ],
    });

    const prMap = generateExercisePRMap([log1, log2]);
    expect(prMap['log-kg-base_0_0']).toBe(true);
    expect(prMap['log-lb-equiv_0_0']).toBeUndefined(); // Matching/equivalent load is NOT a new PR
  });

  it('12. preserves input array and object immutability', () => {
    const log1 = createDummyLog({
      id: 'log-imm-1',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Curl',
          sets: [createDummySet({ setNumber: 1, weight: 30, reps: 10 })],
        }),
      ],
    });

    const cloneBefore = JSON.stringify([log1]);
    generateExercisePRMap([log1]);
    expect(JSON.stringify([log1])).toBe(cloneBefore);
  });

  it('13. repeated calls are deterministic', () => {
    const log1 = createDummyLog({
      id: 'log-det-1',
      date: '2025-01-01',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Curl',
          sets: [createDummySet({ setNumber: 1, weight: 30, reps: 10 })],
        }),
      ],
    });

    const log2 = createDummyLog({
      id: 'log-det-2',
      date: '2025-01-08',
      unit: 'kg',
      exercises: [
        createDummyExercise({
          name: 'Curl',
          sets: [createDummySet({ setNumber: 1, weight: 35, reps: 10 })],
        }),
      ],
    });

    const run1 = generateExercisePRMap([log1, log2]);
    const run2 = generateExercisePRMap([log1, log2]);
    expect(run1).toEqual(run2);
  });
});
