import { describe, it, expect } from 'vitest';
import {
  calculateEpley1RM,
  getUniqueTrackedExercises,
  getStrengthProgression,
  downsampleStrengthHistory,
  getPlateauStatus,
  getPersonalRecords,
  getRecoveryCorrelations,
} from '../historicalAnalytics';
import { WorkoutLog } from '../../types';

describe('Historical Analytics Engine (Phase AS-6A)', () => {
  describe('calculateEpley1RM', () => {
    it('1. Weighted 100 kg × 10 gives Epley 133.333 kg', () => {
      const e1rm = calculateEpley1RM(100, 10);
      expect(e1rm).toBeCloseTo(133.3333, 3);
    });

    it('2. Weighted 100 kg × 1 rep returns raw weight 100 kg', () => {
      const e1rm = calculateEpley1RM(100, 1);
      expect(e1rm).toBe(100);
    });

    it('3. Zero or negative loads or reps return 0', () => {
      expect(calculateEpley1RM(0, 10)).toBe(0);
      expect(calculateEpley1RM(-50, 10)).toBe(0);
      expect(calculateEpley1RM(100, 0)).toBe(0);
      expect(calculateEpley1RM(100, -5)).toBe(0);
      expect(calculateEpley1RM(NaN, 5)).toBe(0);
    });
  });

  describe('getUniqueTrackedExercises', () => {
    it('4. Extracts unique mass-bearing exercises across weighted, bodyweight, and assisted', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          exercises: [
            { name: 'Bench Press', muscleGroup: 'Chest', modality: 'weighted', sets: [] },
            { name: 'Pull-Up', muscleGroup: 'Back', modality: 'bodyweight', sets: [] },
            { name: 'Assisted Dip', muscleGroup: 'Chest', modality: 'assisted', sets: [] },
            { name: 'Running', muscleGroup: 'Cardio', modality: 'distance', sets: [] },
            { name: 'Plank', muscleGroup: 'Core', modality: 'timed', sets: [] },
            { name: 'Skipped Lift', muscleGroup: 'Chest', modality: 'weighted', isSkipped: true, sets: [] },
          ],
        },
      ];

      const unique = getUniqueTrackedExercises(logs);
      expect(unique).toContain('Bench Press');
      expect(unique).toContain('Pull-Up');
      expect(unique).toContain('Assisted Dip');
      expect(unique).not.toContain('Running');
      expect(unique).not.toContain('Plank');
      expect(unique).not.toContain('Skipped Lift');
    });

    it('5. Fallback default returned when no tracked exercises exist', () => {
      expect(getUniqueTrackedExercises([])).toEqual(['Back Squat (High Bar)']);
    });
  });

  describe('getStrengthProgression', () => {
    it('6. Calculates strength progression for weighted exercises in chronological order', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-2',
          date: '2026-01-10',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 8, nutritionCalories: 2600 },
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [
                { setNumber: 1, reps: 10, weight: 100, isWarmup: false, rpe: 8 }, // e1rm = 133.3
                { setNumber: 2, reps: 5, weight: 110, isWarmup: false, rpe: 9 },  // e1rm = 128.33
              ],
            },
          ],
        },
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 7, nutritionCalories: 2400 },
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [
                { setNumber: 1, reps: 8, weight: 90, isWarmup: false, rpe: 7.5 }, // e1rm = 114
              ],
            },
          ],
        },
      ];

      const history = getStrengthProgression(logs, 'Bench Press', 'kg');
      expect(history).toHaveLength(2);
      expect(history[0].date).toBe('Jan 1');
      expect(history[0].maxWeight).toBe(90);
      expect(history[0].max1RM).toBe(114);
      expect(history[0].sleep).toBe(7);
      expect(history[0].calories).toBe(2400);

      expect(history[1].date).toBe('Jan 10');
      expect(history[1].maxWeight).toBe(110);
      expect(history[1].max1RM).toBe(133.3);
      expect(history[1].sleep).toBe(8);
      expect(history[1].calories).toBe(2600);
      expect(history[1].rpe).toBe(8.5);
    });

    it('7. Handles bodyweight exercises with immutable snapshots correctly', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-bw-1',
          date: '2026-02-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          exercises: [
            {
              name: 'Pull-Up',
              muscleGroup: 'Back',
              modality: 'bodyweight',
              sets: [
                { setNumber: 1, reps: 10, isWarmup: false }, // 80 * (1 + 10/30) = 106.666 -> 106.7
              ],
            },
          ],
        },
      ];

      const history = getStrengthProgression(logs, 'Pull-Up', 'kg');
      expect(history).toHaveLength(1);
      expect(history[0].maxWeight).toBe(80);
      expect(history[0].max1RM).toBe(106.7);
    });

    it('8. Safely omits bodyweight sessions with missing or invalid snapshots', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-bw-no-snap',
          date: '2026-02-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          bodyweightSnapshot: undefined,
          exercises: [
            {
              name: 'Pull-Up',
              muscleGroup: 'Back',
              modality: 'bodyweight',
              sets: [{ setNumber: 1, reps: 10, isWarmup: false }],
            },
          ],
        },
      ];

      const history = getStrengthProgression(logs, 'Pull-Up', 'kg');
      expect(history).toHaveLength(0);
    });

    it('9. Handles assisted exercises with inverse assistance load calculation', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-ast-1',
          date: '2026-02-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          exercises: [
            {
              name: 'Assisted Dip',
              muscleGroup: 'Chest',
              modality: 'assisted',
              sets: [
                // 80 - 20 = 60 kg effective load; 60 * (1 + 6/30) = 72 kg e1RM
                { setNumber: 1, weight: 20, reps: 6, isWarmup: false },
              ],
            },
          ],
        },
      ];

      const history = getStrengthProgression(logs, 'Assisted Dip', 'kg');
      expect(history).toHaveLength(1);
      expect(history[0].maxWeight).toBe(60);
      expect(history[0].max1RM).toBe(72);
    });

    it('10. Safely ignores warmup, skipped, uncompleted, or zero-rep sets', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-mixed-sets',
          date: '2026-03-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          exercises: [
            {
              name: 'Deadlift',
              muscleGroup: 'Back',
              modality: 'weighted',
              sets: [
                { setNumber: 1, weight: 60, reps: 10, isWarmup: true },
                { setNumber: 2, weight: 140, reps: 5, isSkipped: true },
                { setNumber: 3, weight: 150, reps: 5, isCompleted: false },
                { setNumber: 4, weight: 160, reps: 0, isWarmup: false },
                { setNumber: 5, weight: 120, reps: 5, isWarmup: false }, // only valid set: 120 * (1 + 5/30) = 140
              ],
            },
          ],
        },
      ];

      const history = getStrengthProgression(logs, 'Deadlift', 'kg');
      expect(history).toHaveLength(1);
      expect(history[0].maxWeight).toBe(120);
      expect(history[0].max1RM).toBe(140);
    });

    it('11. Converts mixed kg/lb logs into requested target unit accurately', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-kg',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Legs',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 10, isWarmup: false }],
            },
          ],
        },
        {
          id: 'log-lb',
          date: '2026-01-08',
          programId: 'p1',
          day: '1',
          unit: 'lb',
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Legs',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 220.462, reps: 10, isWarmup: false }],
            },
          ],
        },
      ];

      const historyInKg = getStrengthProgression(logs, 'Squat', 'kg');
      expect(historyInKg[0].maxWeight).toBe(100);
      expect(historyInKg[0].max1RM).toBe(133.3);
      expect(historyInKg[1].maxWeight).toBe(100);
      expect(historyInKg[1].max1RM).toBe(133.3);

      const historyInLb = getStrengthProgression(logs, 'Squat', 'lb');
      expect(historyInLb[0].maxWeight).toBe(220.5);
      expect(historyInLb[0].max1RM).toBe(293.9);
    });
  });

  describe('downsampleStrengthHistory', () => {
    it('12. Leaves <= 10 items unchanged', () => {
      const sample = Array.from({ length: 5 }, (_, i) => ({
        date: `Jan ${i + 1}`,
        maxWeight: 100 + i,
        max1RM: 120 + i,
        sleep: 8,
        calories: 2500,
        rpe: 8,
      }));

      const downsampled = downsampleStrengthHistory(sample, 10);
      expect(downsampled).toHaveLength(5);
      expect(downsampled).toEqual(sample);
    });

    it('13. Downsamples > 10 items to 10 points while preserving bucket peak 1RMs', () => {
      const sample = Array.from({ length: 30 }, (_, i) => ({
        date: `Day ${i + 1}`,
        maxWeight: 100 + (i % 5),
        max1RM: (i === 14) ? 200 : 100 + i, // Day 15 has a spike
        sleep: 8,
        calories: 2500,
        rpe: 8,
      }));

      const downsampled = downsampleStrengthHistory(sample, 10);
      expect(downsampled).toHaveLength(10);
      expect(downsampled.some(p => p.max1RM === 200)).toBe(true);
    });
  });

  describe('getPlateauStatus', () => {
    it('14. Returns Insufficient Data when fewer than 3 sessions exist', () => {
      const history = [
        { date: 'Jan 1', maxWeight: 100, max1RM: 120, sleep: 8, calories: 2500, rpe: 8 },
        { date: 'Jan 8', maxWeight: 105, max1RM: 125, sleep: 8, calories: 2500, rpe: 8 },
      ];
      expect(getPlateauStatus(history).status).toBe('Insufficient Data');
    });

    it('15. Returns Breaking Through for ascending last three sessions', () => {
      const history = [
        { date: 'Jan 1', maxWeight: 100, max1RM: 120, sleep: 8, calories: 2500, rpe: 8 },
        { date: 'Jan 8', maxWeight: 105, max1RM: 125, sleep: 8, calories: 2500, rpe: 8 },
        { date: 'Jan 15', maxWeight: 110, max1RM: 130, sleep: 8, calories: 2500, rpe: 8 },
      ];
      expect(getPlateauStatus(history).status).toBe('Breaking Through');
    });

    it('16. Returns Strength Plateau when last three sessions are within 1 kg', () => {
      const history = [
        { date: 'Jan 1', maxWeight: 100, max1RM: 120.0, sleep: 8, calories: 2500, rpe: 8 },
        { date: 'Jan 8', maxWeight: 100, max1RM: 120.4, sleep: 8, calories: 2500, rpe: 8 },
        { date: 'Jan 15', maxWeight: 100, max1RM: 120.2, sleep: 8, calories: 2500, rpe: 8 },
      ];
      expect(getPlateauStatus(history).status).toBe('Strength Plateau');
    });

    it('17. Returns Stable Strength for other non-plateau, non-breakthrough fluctuations', () => {
      const history = [
        { date: 'Jan 1', maxWeight: 100, max1RM: 130, sleep: 8, calories: 2500, rpe: 8 },
        { date: 'Jan 8', maxWeight: 100, max1RM: 120, sleep: 8, calories: 2500, rpe: 8 },
        { date: 'Jan 15', maxWeight: 100, max1RM: 125, sleep: 8, calories: 2500, rpe: 8 },
      ];
      expect(getPlateauStatus(history).status).toBe('Stable Strength');
    });
  });

  describe('getPersonalRecords', () => {
    it('18. Computes all-time PRs for weighted exercises with correct e1RM', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 8, nutritionCalories: 2700, hydrationLevel: 'Optimal' },
          exercises: [
            {
              name: 'Overhead Press',
              modality: 'weighted',
              muscleGroup: 'Shoulders',
              sets: [
                { setNumber: 1, weight: 60, reps: 5, isWarmup: false }, // 60 * (1 + 5/30) = 70
              ],
            },
          ],
        },
        {
          id: 'log-2',
          date: '2026-01-15',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 7.5, nutritionCalories: 2600, hydrationLevel: 'Adequate' },
          exercises: [
            {
              name: 'Overhead Press',
              modality: 'weighted',
              muscleGroup: 'Shoulders',
              sets: [
                { setNumber: 1, weight: 65, reps: 5, isWarmup: false }, // 65 * (1 + 5/30) = 75.83 -> 75.8
              ],
            },
          ],
        },
      ];

      const prs = getPersonalRecords(logs, 'kg');
      expect(prs).toHaveLength(1);
      expect(prs[0].exercise).toBe('Overhead Press');
      expect(prs[0].est1RM).toBe(75.8);
      expect(prs[0].weight).toBe(65);
      expect(prs[0].reps).toBe(5);
      expect(prs[0].date).toBe('2026-01-15');
      expect(prs[0].sleep).toBe(7.5);
      expect(prs[0].calories).toBe(2600);
      expect(prs[0].hydration).toBe('Adequate');
      expect(prs[0].muscleGroup).toBe('Shoulders');
    });

    it('19. Accurately calculates bodyweight PRs with historical snapshot', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-bw-pr',
          date: '2026-02-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          bodyweightSnapshot: { value: 75, unit: 'kg' },
          exercises: [
            {
              name: 'Chin-Up',
              modality: 'bodyweight',
              muscleGroup: 'Back',
              sets: [
                { setNumber: 1, reps: 15, isWarmup: false }, // 75 * (1 + 15/30) = 112.5
              ],
            },
          ],
        },
      ];

      const prs = getPersonalRecords(logs, 'kg');
      expect(prs).toHaveLength(1);
      expect(prs[0].exercise).toBe('Chin-Up');
      expect(prs[0].est1RM).toBe(112.5);
      expect(prs[0].weight).toBe(75);
      expect(prs[0].reps).toBe(15);
    });

    it('20. Accurately calculates assisted PRs with inverse assistance load', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-ast-pr',
          date: '2026-02-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          exercises: [
            {
              name: 'Assisted Pull-Up',
              modality: 'assisted',
              muscleGroup: 'Back',
              sets: [
                // 80 - 15 = 65 kg; 65 * (1 + 10/30) = 86.666 -> 86.7
                { setNumber: 1, weight: 15, reps: 10, isWarmup: false },
              ],
            },
          ],
        },
      ];

      const prs = getPersonalRecords(logs, 'kg');
      expect(prs).toHaveLength(1);
      expect(prs[0].exercise).toBe('Assisted Pull-Up');
      expect(prs[0].est1RM).toBe(86.7);
      expect(prs[0].weight).toBe(65);
      expect(prs[0].reps).toBe(10);
    });

    it('21. Sorts all-time PRs in descending order of est1RM', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-multi-ex',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          exercises: [
            {
              name: 'Bicep Curl',
              muscleGroup: 'Arms',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 20, reps: 10, isWarmup: false }], // 26.7
            },
            {
              name: 'Deadlift',
              muscleGroup: 'Back',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 200, reps: 5, isWarmup: false }], // 233.3
            },
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 10, isWarmup: false }], // 133.3
            },
          ],
        },
      ];

      const prs = getPersonalRecords(logs, 'kg');
      expect(prs.map(p => p.exercise)).toEqual(['Deadlift', 'Bench Press', 'Bicep Curl']);
    });
  });

  describe('getRecoveryCorrelations', () => {
    it('22. Returns Needs 2+ Logs when fewer than 2 valid sessions exist', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Legs',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 5, isWarmup: false }],
            },
          ],
        },
      ];

      const corr = getRecoveryCorrelations(logs, 'Squat', 'kg');
      expect(corr.sleepFactor).toBe('Needs 2+ Logs');
      expect(corr.calFactor).toBe('Needs 2+ Logs');
      expect(corr.isCalculated).toBe(false);
    });

    it('23. Computes sleep and calorie correlations across sessions correctly', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 6, nutritionCalories: 2000 },
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Legs',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 5, isWarmup: false }], // 116.666 kg
            },
          ],
        },
        {
          id: 'log-2',
          date: '2026-01-08',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 8, nutritionCalories: 2800 },
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Legs',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 120, reps: 5, isWarmup: false }], // 140 kg
            },
          ],
        },
      ];

      const corr = getRecoveryCorrelations(logs, 'Squat', 'kg');
      expect(corr.isCalculated).toBe(true);
      expect(corr.sleepCount).toBe(2);
      expect(corr.calCount).toBe(2);
      expect(corr.sleepFactor).toBe('+20.0%');
      expect(corr.calFactor).toBe('+20.0%');
      expect(corr.targetSleep).toBeGreaterThanOrEqual(7.5);
      expect(corr.targetCalories).toBe(2800);
    });

    it('24. Handles constant sleep and constant calories with Stable description', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 8, nutritionCalories: 2500 },
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Legs',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 5, isWarmup: false }],
            },
          ],
        },
        {
          id: 'log-2',
          date: '2026-01-08',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 8, nutritionCalories: 2500 },
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Legs',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 110, reps: 5, isWarmup: false }],
            },
          ],
        },
      ];

      const corr = getRecoveryCorrelations(logs, 'Squat', 'kg');
      expect(corr.sleepFactor).toBe('Stable (0.0%)');
      expect(corr.calFactor).toBe('Stable (0.0%)');
    });

    it('25. Works seamlessly with bodyweight and assisted modalities in recovery correlations', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          recovery: { sleepHours: 6, nutritionCalories: 2000 },
          exercises: [
            {
              name: 'Pull-Up',
              muscleGroup: 'Back',
              modality: 'bodyweight',
              sets: [{ setNumber: 1, reps: 5, isWarmup: false }], // 80 * (1 + 5/30) = 93.33 kg
            },
          ],
        },
        {
          id: 'log-2',
          date: '2026-01-08',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          recovery: { sleepHours: 8.5, nutritionCalories: 2700 },
          exercises: [
            {
              name: 'Pull-Up',
              muscleGroup: 'Back',
              modality: 'bodyweight',
              sets: [{ setNumber: 1, reps: 10, isWarmup: false }], // 80 * (1 + 10/30) = 106.67 kg
            },
          ],
        },
      ];

      const corr = getRecoveryCorrelations(logs, 'Pull-Up', 'kg');
      expect(corr.isCalculated).toBe(true);
      expect(corr.sleepFactor).toContain('+');
      expect(corr.targetSleep).toBe(8.5);
      expect(corr.targetCalories).toBe(2700);
    });
  });

  describe('Deep immutability check', () => {
    it('26. Does not mutate input logs during any analysis calculation', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-imm-1',
          date: '2026-01-10',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 8, nutritionCalories: 2500 },
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 5, isWarmup: false }],
            },
          ],
        },
        {
          id: 'log-imm-2',
          date: '2026-01-01',
          programId: 'p1',
          day: '1',
          unit: 'kg',
          recovery: { sleepHours: 7, nutritionCalories: 2200 },
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 90, reps: 5, isWarmup: false }],
            },
          ],
        },
      ];

      const logsSnapshot = JSON.parse(JSON.stringify(logs));

      getStrengthProgression(logs, 'Bench Press', 'kg');
      getPersonalRecords(logs, 'kg');
      getRecoveryCorrelations(logs, 'Bench Press', 'kg');

      expect(logs).toEqual(logsSnapshot);
    });
  });
});
