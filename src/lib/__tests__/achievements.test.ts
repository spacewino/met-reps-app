import { describe, it, expect } from 'vitest';
import { WorkoutLog } from '../../types';
import { evaluateAchievements, checkWeightedLiftingMilestone, getSetVolumeKg } from '../achievements';

describe('Achievements Engine & Unit Safety', () => {
  it('correctly calculates single set volume in kg across modalities and units', () => {
    // 1. Weighted in kg
    expect(getSetVolumeKg(100, 5, 'weighted', 'kg')).toBe(500);

    // 2. Weighted in lb (100 lb * 5 reps * 0.45359237 kg/lb = 226.796 kg)
    expect(getSetVolumeKg(100, 5, 'weighted', 'lb')).toBeCloseTo(226.8, 1);

    // 3. Bodyweight with valid snapshot (80 kg * 10 reps = 800 kg)
    expect(getSetVolumeKg(0, 10, 'bodyweight', 'kg', { value: 80, unit: 'kg' })).toBe(800);

    // 4. Bodyweight with lb snapshot (176.3696 lb = 80 kg * 10 reps = 800 kg)
    expect(getSetVolumeKg(0, 10, 'bodyweight', 'kg', { value: 176.3696, unit: 'lb' })).toBeCloseTo(800, 1);

    // 5. Bodyweight without snapshot -> returns 0 (safe exclusion)
    expect(getSetVolumeKg(0, 10, 'bodyweight', 'kg', null)).toBe(0);

    // 6. Assisted with valid snapshot (80 kg bw - 20 kg assist = 60 kg net * 5 reps = 300 kg)
    expect(getSetVolumeKg(20, 5, 'assisted', 'kg', { value: 80, unit: 'kg' })).toBe(300);

    // 7. Distance / Timed modalities -> returns 0
    expect(getSetVolumeKg(0, 5, 'distance', 'kg')).toBe(0);
    expect(getSetVolumeKg(0, 5, 'timed', 'kg')).toBe(0);

    // 8. Incomplete / invalid reps -> returns 0
    expect(getSetVolumeKg(100, 0, 'weighted', 'kg')).toBe(0);
    expect(getSetVolumeKg(100, null, 'weighted', 'kg')).toBe(0);
  });

  it('evaluates basic workout quantity and tonnage achievements', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-1',
        date: '2026-01-01',
        programId: 'p1',
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Squat',
            muscleGroup: 'Quads',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: 100, reps: 10, isCompleted: true, form: 'strict', rpe: 8 }, // 1000 kg
            ],
          },
        ],
      },
    ];

    const achievements = evaluateAchievements(logs);
    const ironInitiate = achievements.find(a => a.id === 'iron-initiate');
    expect(ironInitiate?.unlocked).toBe(true);

    const dedicatedLifter = achievements.find(a => a.id === 'dedicated-lifter');
    expect(dedicatedLifter?.unlocked).toBe(false);
    expect(dedicatedLifter?.currentStatusText).toBe('1 / 10 workouts');
  });

  it('handles cross-unit tonnage and PR progression safely', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-1',
        date: '2026-01-01',
        programId: 'p1',
        week: '1',
        day: '1',
        unit: 'lb',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            // 200 lb * 5 reps = 1000 lb volume = ~453.6 kg volume
            sets: [{ setNumber: 1, weight: 200, reps: 5, isCompleted: true }],
          },
        ],
      },
      {
        id: 'log-2',
        date: '2026-01-08',
        programId: 'p1',
        week: '2',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            // 100 kg * 5 reps = 500 kg volume (> previous 200 lb = 90.7 kg e1RM baseline)
            sets: [{ setNumber: 1, weight: 100, reps: 5, isCompleted: true, rpe: 7.5 }],
          },
        ],
      },
    ];

    const achievements = evaluateAchievements(logs);
    const casualPr = achievements.find(a => a.id === 'casual-pr');
    // Session 2 broke baseline e1RM at RPE 7.5 (<= 8)
    expect(casualPr?.unlocked).toBe(true);
  });

  it('unlocks "one-more-rep" achievement when beating rep record at identical load', () => {
    const logs: WorkoutLog[] = [
      {
        id: 'log-1',
        date: '2026-01-01',
        programId: 'p1',
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Overhead Press',
            muscleGroup: 'Shoulders',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 60, reps: 5, isCompleted: true }],
          },
        ],
      },
      {
        id: 'log-2',
        date: '2026-01-08',
        programId: 'p1',
        week: '2',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            name: 'Overhead Press',
            muscleGroup: 'Shoulders',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 60, reps: 6, isCompleted: true }],
          },
        ],
      },
    ];

    const achievements = evaluateAchievements(logs);
    const oneMoreRep = achievements.find(a => a.id === 'one-more-rep');
    expect(oneMoreRep?.unlocked).toBe(true);
  });

  describe('Weighted Lifting Milestones (checkWeightedLiftingMilestone)', () => {
    it('detects 100 kg Bench Press milestone in kg logs', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          week: '1',
          day: '1',
          unit: 'kg',
          exercises: [
            {
              name: 'Barbell Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 1, isCompleted: true }],
            },
          ],
        },
      ];

      expect(checkWeightedLiftingMilestone(logs, /bench/i, 100)).toBe(true);
    });

    it('detects 100 kg Bench Press milestone in lb logs at boundary (220.462 lb)', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          week: '1',
          day: '1',
          unit: 'lb',
          exercises: [
            {
              name: 'Flat Barbell Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 220.4623, reps: 3, isCompleted: true }],
            },
          ],
        },
      ];

      expect(checkWeightedLiftingMilestone(logs, /bench/i, 100)).toBe(true);
    });

    it('does NOT unlock 100 kg Bench Press if recorded as 100 lb in lb log', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          week: '1',
          day: '1',
          unit: 'lb', // 100 lb = 45.36 kg, NOT 100 kg!
          exercises: [
            {
              name: 'Barbell Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 1, isCompleted: true }],
            },
          ],
        },
      ];

      expect(checkWeightedLiftingMilestone(logs, /bench/i, 100)).toBe(false);
    });

    it('does NOT unlock weighted milestones for bodyweight or assisted exercises', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          week: '1',
          day: '1',
          unit: 'kg',
          bodyweightSnapshot: { value: 105, unit: 'kg' },
          exercises: [
            {
              name: 'Bench Dip',
              muscleGroup: 'Chest',
              modality: 'bodyweight', // Bodyweight modality should NOT trigger barbell milestone
              sets: [{ setNumber: 1, reps: 10, isCompleted: true }],
            },
            {
              name: 'Assisted Bench Press Machine',
              muscleGroup: 'Chest',
              modality: 'assisted',
              sets: [{ setNumber: 1, weight: 10, reps: 10, isCompleted: true }],
            },
          ],
        },
      ];

      expect(checkWeightedLiftingMilestone(logs, /bench/i, 100)).toBe(false);
    });

    it('detects 140 kg Squat and 180 kg Deadlift milestones in lb logs at boundaries', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          week: '1',
          day: '1',
          unit: 'lb',
          exercises: [
            // 308.647 lb = 140 kg
            {
              name: 'Back Squat',
              muscleGroup: 'Quads',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 308.65, reps: 1, isCompleted: true }],
            },
            // 396.832 lb = 180 kg
            {
              name: 'Conventional Deadlift',
              muscleGroup: 'Back',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 396.84, reps: 1, isCompleted: true }],
            },
          ],
        },
      ];

      expect(checkWeightedLiftingMilestone(logs, /squat/i, 140)).toBe(true);
      expect(checkWeightedLiftingMilestone(logs, /deadlift/i, 180)).toBe(true);
    });
  });
});
