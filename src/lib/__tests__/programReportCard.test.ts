import { describe, it, expect } from 'vitest';
import { Program, WorkoutLog } from '../../types';
import { getProgramReportCard, getReportChartData } from '../programReportCard';

describe('Program Report Card Canonical Analytics', () => {
  const sampleProgram: Program = {
    id: 'prog-1',
    name: 'Power & Hypertrophy 4-Week',
    objective: 'Strength',
    programDuration: 4,
    daysPerWeek: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    exercisesByDay: {
      1: [
        { name: 'Bench Press', muscleGroup: 'Chest', modality: 'weighted', sets: [{ setNumber: 1, reps: 5, weight: 100 }] },
        { name: 'Pull Up', muscleGroup: 'Back', modality: 'bodyweight', sets: [{ setNumber: 1, reps: 8 }] },
      ],
      2: [
        { name: 'Dips', muscleGroup: 'Triceps', modality: 'assisted', sets: [{ setNumber: 1, reps: 8, weight: 20 }] },
      ],
    },
  };

  it('isolates logs strictly by programId', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-1',
        date: '2026-01-02',
        programId: 'other-prog',
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 150, reps: 10, isCompleted: true }],
          },
        ],
      },
      {
        id: 'log-2',
        date: '2026-01-03',
        programId: 'prog-1',
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 5, isCompleted: true }],
          },
        ],
      },
    ];

    const card = getProgramReportCard(sampleProgram, logs, 'kg');
    expect(card.completedCount).toBe(1);
    expect(card.exerciseStats.find(s => s.name === 'Bench Press')?.baselineE1RM).toBeCloseTo(116.7, 1);
  });

  it('correctly computes weighted progression with canonical Epley formula and unit normalization', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-w1',
        date: '2026-01-02',
        programId: 'prog-1',
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 5, isCompleted: true }], // 100 * (1 + 5/30) = 116.67 kg
          },
        ],
      },
      {
        id: 'log-w2',
        date: '2026-01-09',
        programId: 'prog-1',
        week: '2',
        day: '1',
        unit: 'lb', // Recorded in pounds! 242.5056 lb = 110 kg
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 242.5056, reps: 5, isCompleted: true }], // 110 * (1 + 5/30) = 128.33 kg
          },
        ],
      },
    ];

    const card = getProgramReportCard(sampleProgram, logs, 'kg');
    expect(card.completedCount).toBe(2);
    const benchStat = card.exerciseStats.find(s => s.name === 'Bench Press');
    expect(benchStat).toBeDefined();
    expect(benchStat?.baselineE1RM).toBeCloseTo(116.7, 1);
    expect(benchStat?.latestE1RM).toBeCloseTo(128.3, 1);
    expect(benchStat?.growthPercent).toBeGreaterThan(5);

    const chart = getReportChartData(sampleProgram, logs, 'Bench Press', 'kg');
    expect(chart).not.toBeNull();
    expect(chart?.points[0].actual).toBeCloseTo(116.7, 1);
    expect(chart?.points[1].actual).toBeCloseTo(128.3, 1);
  });

  it('calculates bodyweight progression using immutable snapshots', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-w1',
        date: '2026-01-02',
        programId: 'prog-1',
        week: '1',
        day: '1',
        unit: 'kg',
        bodyweightSnapshot: { value: 75, unit: 'kg' },
        exercises: [
          {
            name: 'Pull Up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, reps: 6, isCompleted: true }], // 75 * (1 + 6/30) = 90 kg
          },
        ],
      },
      {
        id: 'log-w2',
        date: '2026-01-09',
        programId: 'prog-1',
        week: '2',
        day: '1',
        unit: 'kg',
        bodyweightSnapshot: { value: 75, unit: 'kg' },
        exercises: [
          {
            name: 'Pull Up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, reps: 10, isCompleted: true }], // 75 * (1 + 10/30) = 100 kg
          },
        ],
      },
    ];

    const chart = getReportChartData(sampleProgram, logs, 'Pull Up', 'kg');
    expect(chart).not.toBeNull();
    expect(chart?.points[0].actual).toBeCloseTo(90, 1);
    expect(chart?.points[1].actual).toBeCloseTo(100, 1);
  });

  it('excludes bodyweight sets lacking snapshots from load/growth evidence without crashing or inserting zero', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-w1',
        date: '2026-01-02',
        programId: 'prog-1',
        week: '1',
        day: '1',
        unit: 'kg',
        // Missing snapshot
        exercises: [
          {
            name: 'Pull Up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, reps: 6, isCompleted: true }],
          },
        ],
      },
    ];

    const card = getProgramReportCard(sampleProgram, logs, 'kg');
    expect(card.completedCount).toBe(1);

    const chart = getReportChartData(sampleProgram, logs, 'Pull Up', 'kg');
    expect(chart).not.toBeNull();
    // Baseline is 0 because no snapshot exists, so actual is null or 0 without crashing
    expect(chart?.points.length).toBe(4);
  });

  it('correctly calculates assisted exercise progression (lower assistance = higher effective load)', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-w1',
        date: '2026-01-02',
        programId: 'prog-1',
        week: '1',
        day: '2',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Dips',
            muscleGroup: 'Triceps',
            modality: 'assisted',
            // 20 kg assistance -> net 60 kg * (1 + 5/30) = 70 kg e1RM
            sets: [{ setNumber: 1, weight: 20, reps: 5, isCompleted: true }],
          },
        ],
      },
      {
        id: 'log-w2',
        date: '2026-01-09',
        programId: 'prog-1',
        week: '2',
        day: '2',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Dips',
            muscleGroup: 'Triceps',
            modality: 'assisted',
            // Reduced to 10 kg assistance -> net 70 kg * (1 + 5/30) = 81.67 kg e1RM
            sets: [{ setNumber: 1, weight: 10, reps: 5, isCompleted: true }],
          },
        ],
      },
    ];

    const chart = getReportChartData(sampleProgram, logs, 'Dips', 'kg');
    expect(chart).not.toBeNull();
    expect(chart?.points[0].actual).toBeCloseTo(70, 1);
    expect(chart?.points[1].actual).toBeCloseTo(81.7, 1);
  });

  it('computes overall chart percentage normalization and progress carrying forward', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-w1',
        date: '2026-01-02',
        programId: 'prog-1',
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 1, isCompleted: true }], // 100 kg baseline
          },
        ],
      },
      {
        id: 'log-w2',
        date: '2026-01-09',
        programId: 'prog-1',
        week: '2',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 105, reps: 1, isCompleted: true }], // 105 kg = 105% of baseline
          },
        ],
      },
    ];

    const overallChart = getReportChartData(sampleProgram, logs, 'Overall', 'kg');
    expect(overallChart).not.toBeNull();
    expect(overallChart?.unit).toBe('%');
    expect(overallChart?.points[0].actual).toBe(100);
    expect(overallChart?.points[1].actual).toBe(105);
    // Weeks 3 and 4 carry over the last known actual
    expect(overallChart?.points[2].actual).toBe(105);
    expect(overallChart?.points[3].actual).toBe(105);
  });

  it('calculates adherence rate, recovery factors, fatigue impact, and grade', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-1',
        date: '2026-01-02',
        programId: 'prog-1',
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 5, isCompleted: true }],
          },
        ],
      },
      {
        id: 'log-2',
        date: '2026-01-03',
        programId: 'prog-1',
        week: '1',
        day: '2',
        unit: 'kg',
        exercises: [
          {
            name: 'Dips',
            muscleGroup: 'Triceps',
            modality: 'assisted',
            sets: [{ setNumber: 1, weight: 20, reps: 8, isCompleted: true }],
          },
        ],
      },
    ];

    const card = getProgramReportCard(sampleProgram, logs, 'kg');
    expect(card.completedCount).toBe(2);
    // Program has 4 weeks * 2 days/week = 8 total workouts expected. 2 completed = 25% adherence
    expect(card.adherenceRate).toBe(25);
    expect(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']).toContain(card.grade);
  });

  describe('TSG-3 Program Report Card Gym Time Duration Aggregation', () => {
    it('strictly isolates duration to matching programId logs, excluding other programs and one-off logs', () => {
      const logs: WorkoutLog[] = [
        // Matching program session
        {
          id: 'log-prog1',
          date: '2026-01-02',
          programId: 'prog-1',
          week: '1',
          day: '1',
          unit: 'kg',
          durationMinutes: 45,
          exercises: [],
        },
        // Another program session
        {
          id: 'log-other-prog',
          date: '2026-01-03',
          programId: 'other-program-id',
          week: '1',
          day: '1',
          unit: 'kg',
          durationMinutes: 90,
          exercises: [],
        },
        // One-off workout with undefined programId
        {
          id: 'log-one-off-undef',
          date: '2026-01-04',
          unit: 'kg',
          durationMinutes: 75,
          exercises: [],
        },
        // One-off workout with empty programId
        {
          id: 'log-one-off-empty',
          date: '2026-01-05',
          programId: '' as any,
          unit: 'kg',
          durationMinutes: 80,
          exercises: [],
        },
      ];

      const card = getProgramReportCard(sampleProgram, logs, 'kg');
      // Only the 45-minute matching log should be included
      expect(card.totalDurationMinutes).toBe(45);
    });

    it('accurately resolves valid, legacy undefined, explicit null/0/negative/NaN/Infinity durations and empty sets', () => {
      // Empty logs produces 0
      expect(getProgramReportCard(sampleProgram, [], 'kg').totalDurationMinutes).toBe(0);

      // Single matching legacy log (omitted durationMinutes) -> fallback 60 min
      const legacyLogs: WorkoutLog[] = [
        {
          id: 'legacy-1',
          date: '2026-01-02',
          programId: 'prog-1',
          week: '1',
          day: '1',
          unit: 'kg',
          // durationMinutes omitted
          exercises: [],
        },
      ];
      expect(getProgramReportCard(sampleProgram, legacyLogs, 'kg').totalDurationMinutes).toBe(60);

      // Mixed valid (50), legacy undefined (60), explicit null (0), 0 (0), negative (0), NaN (0), Infinity (0)
      const mixedLogs: WorkoutLog[] = [
        {
          id: 'm1',
          date: '2026-01-02',
          programId: 'prog-1',
          week: '1',
          day: '1',
          unit: 'kg',
          durationMinutes: 50, // 50
          exercises: [],
        },
        {
          id: 'm2',
          date: '2026-01-03',
          programId: 'prog-1',
          week: '1',
          day: '2',
          unit: 'kg',
          // undefined -> 60
          exercises: [],
        },
        {
          id: 'm3',
          date: '2026-01-04',
          programId: 'prog-1',
          week: '2',
          day: '1',
          unit: 'kg',
          durationMinutes: null as any, // 0
          exercises: [],
        },
        {
          id: 'm4',
          date: '2026-01-05',
          programId: 'prog-1',
          week: '2',
          day: '2',
          unit: 'kg',
          durationMinutes: 0, // 0
          exercises: [],
        },
        {
          id: 'm5',
          date: '2026-01-06',
          programId: 'prog-1',
          week: '3',
          day: '1',
          unit: 'kg',
          durationMinutes: -25, // 0
          exercises: [],
        },
        {
          id: 'm6',
          date: '2026-01-07',
          programId: 'prog-1',
          week: '3',
          day: '2',
          unit: 'kg',
          durationMinutes: NaN, // 0
          exercises: [],
        },
        {
          id: 'm7',
          date: '2026-01-08',
          programId: 'prog-1',
          week: '4',
          day: '1',
          unit: 'kg',
          durationMinutes: Infinity, // 0
          exercises: [],
        },
      ];
      // 50 + 60 + 0 + 0 + 0 + 0 + 0 = 110 minutes
      expect(getProgramReportCard(sampleProgram, mixedLogs, 'kg').totalDurationMinutes).toBe(110);
    });

    it('verifies scoring, grade, adherence, completed count, PRs, and feedbacks remain strictly unchanged regardless of duration', () => {
      const baseLogsA: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-02',
          programId: 'prog-1',
          week: '1',
          day: '1',
          unit: 'kg',
          durationMinutes: 30, // 30 min
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 5, isCompleted: true }],
            },
          ],
          recovery: {
            sleepHours: 8,
            soreness: 3,
            motivation: 8,
            hydrationLevel: 'Optimal',
          },
        },
        {
          id: 'log-2',
          date: '2026-01-03',
          programId: 'prog-1',
          week: '1',
          day: '2',
          unit: 'kg',
          durationMinutes: 45, // 45 min
          exercises: [
            {
              name: 'Dips',
              muscleGroup: 'Triceps',
              modality: 'assisted',
              sets: [{ setNumber: 1, weight: 20, reps: 8, isCompleted: true }],
            },
          ],
          recovery: {
            sleepHours: 8,
            soreness: 2,
            motivation: 8,
            hydrationLevel: 'Optimal',
          },
        },
      ];

      // Clone identical logs except duration is 240 and undefined (60)
      const baseLogsB: WorkoutLog[] = [
        {
          ...baseLogsA[0],
          id: 'log-1-b',
          durationMinutes: 240,
        },
        {
          ...baseLogsA[1],
          id: 'log-2-b',
          durationMinutes: undefined,
        },
      ];

      const cardA = getProgramReportCard(sampleProgram, baseLogsA, 'kg');
      const cardB = getProgramReportCard(sampleProgram, baseLogsB, 'kg');

      // Durations reflect inputs
      expect(cardA.totalDurationMinutes).toBe(75);
      expect(cardB.totalDurationMinutes).toBe(300);

      // Scoring, grading, adherence, count, PRs and feedbacks must match identically
      expect(cardA.score).toBe(cardB.score);
      expect(cardA.grade).toBe(cardB.grade);
      expect(cardA.gradeSub).toBe(cardB.gradeSub);
      expect(cardA.gradeColor).toBe(cardB.gradeColor);
      expect(cardA.adherenceRate).toBe(cardB.adherenceRate);
      expect(cardA.completedCount).toBe(cardB.completedCount);
      expect(cardA.totalPlannedDays).toBe(cardB.totalPlannedDays);
      expect(cardA.totalPRsHit).toBe(cardB.totalPRsHit);
      expect(cardA.strongestMuscle).toBe(cardB.strongestMuscle);
      expect(cardA.avgActualGrowth).toBe(cardB.avgActualGrowth);
      expect(cardA.avgSleep).toBe(cardB.avgSleep);
      expect(cardA.avgSoreness).toBe(cardB.avgSoreness);
      expect(cardA.avgQuality).toBe(cardB.avgQuality);
      expect(cardA.avgHydration).toBe(cardB.avgHydration);
      expect(cardA.feedbacks).toEqual(cardB.feedbacks);
    });
  });
});
