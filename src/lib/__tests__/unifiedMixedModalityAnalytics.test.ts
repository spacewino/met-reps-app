/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { generateDiarySessionSummary } from '../diarySessionSummary';
import { generateDiaryMuscleSetStats } from '../diaryMuscleSetPeriod';
import { generateExercisePRMap } from '../diaryExercisePRs';
import { getPersonalRecords, getStrengthProgression, calculateEpley1RM } from '../historicalAnalytics';
import { generateDiaryScorecardMap, classifyDiaryWorkout } from '../diaryInsights';
import { evaluateAchievements } from '../achievements';
import { getProgramReportCard } from '../programReportCard';
import { calculateE1RMForSet } from '../rpeMath';
import { WorkoutLog, Program } from '../../types';

describe('Unified Mixed-Modality Analytics Regression Test', () => {
  // Canonical fixture matching Section 3 specifications:
  // - weighted completed set: 100 kg x 10 @ RPE 8
  // - pure-bodyweight completed set: snapshot 110 kg, saved set.weight: 110, 10 reps @ RPE 8
  // - assisted completed set: snapshot 110 kg, assistance 20 kg, 8 reps @ RPE 8
  // - one warm-up
  // - one skipped set
  // - one incomplete set
  const fixtureLog: WorkoutLog = {
    id: 'log-unified-mixed-001',
    date: '2026-08-20',
    unit: 'kg',
    programId: 'prog-mixed-test',
    week: '1',
    day: '1',
    bodyweightSnapshot: { value: 110, unit: 'kg' },
    exercises: [
      {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, form: 'standard', isCompleted: true, isWarmup: false },
          { setNumber: 2, weight: 60, reps: 10, isWarmup: true, isCompleted: true },
          { setNumber: 3, weight: 100, reps: 10, isSkipped: true, isCompleted: false },
          { setNumber: 4, weight: 100, reps: 0, isCompleted: false },
        ]
      },
      {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [
          { setNumber: 1, weight: 110, reps: 10, rpe: 8.0, form: 'standard', isCompleted: true }
        ]
      },
      {
        name: 'Assisted Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        sets: [
          { setNumber: 1, weight: 20, reps: 8, rpe: 8.0, form: 'standard', isCompleted: true }
        ]
      }
    ]
  };

  const sampleProgram: Program = {
    id: 'prog-mixed-test',
    name: 'Mixed Modality Program',
    objective: 'Strength',
    daysPerWeek: 1,
    programDuration: 4,
    createdAt: '2026-08-20T00:00:00Z',
    exercisesByDay: {
      1: [
        { name: 'Bench Press', muscleGroup: 'Chest', sets: [{ setNumber: 1, reps: 10 }] },
        { name: 'Pull-up', muscleGroup: 'Back', sets: [{ setNumber: 1, reps: 10 }] },
        { name: 'Assisted Dip', muscleGroup: 'Chest', sets: [{ setNumber: 1, reps: 8 }] }
      ]
    }
  };

  const logs = [fixtureLog];

  it('verifies immutability: deep snapshot before and after execution', () => {
    const serializedBefore = JSON.stringify(logs);

    // 1. Diary Session Summary
    const summary = generateDiarySessionSummary(fixtureLog);
    expect(summary.completedWorkingSetCount).toBe(3);
    expect(summary.workingVolume.valueKg).toBe(2820);
    expect(summary.workingVolume.status).toBe('complete');

    // 2. Diary Muscle Period Totals
    const pinnedDate = new Date('2026-08-20T12:00:00Z');
    const periodStats = generateDiaryMuscleSetStats(logs, 'this_week', pinnedDate);
    expect(periodStats.totalSets).toBe(3);
    expect(periodStats.muscleSets.Pecs).toBe(2);
    expect(periodStats.muscleSets.Back).toBe(1);

    // 3. Diary PR Map
    const prMap = generateExercisePRMap(logs);
    expect(prMap['log-unified-mixed-001_0_0']).toBe(true);
    expect(prMap['log-unified-mixed-001_1_0']).toBe(true);
    expect(prMap['log-unified-mixed-001_2_0']).toBe(true);
    // Warmup, skipped, incomplete sets must not be in PR map
    expect(prMap['log-unified-mixed-001_0_1']).toBeUndefined();
    expect(prMap['log-unified-mixed-001_0_2']).toBeUndefined();
    expect(prMap['log-unified-mixed-001_0_3']).toBeUndefined();

    // 4. Historical Personal Records
    const prs = getPersonalRecords(logs, 'kg');
    expect(prs).toHaveLength(3);
    const benchPR = prs.find(p => p.exercise === 'Bench Press');
    const pullupPR = prs.find(p => p.exercise === 'Pull-up');
    const dipPR = prs.find(p => p.exercise === 'Assisted Dip');

    expect(benchPR?.weight).toBe(100);
    expect(benchPR?.est1RM).toBeCloseTo(133.3, 1);

    expect(pullupPR?.weight).toBe(110);
    expect(pullupPR?.est1RM).toBeCloseTo(146.7, 1);

    expect(dipPR?.weight).toBe(90); // 110 - 20 assistance = 90kg effective
    expect(dipPR?.est1RM).toBeCloseTo(114.0, 1);

    // 5. Strength Progression Trends
    const benchTrend = getStrengthProgression(logs, 'Bench Press', 'kg');
    expect(benchTrend[0].maxWeight).toBe(100);
    expect(benchTrend[0].max1RM).toBeCloseTo(133.3, 1);

    const pullupTrend = getStrengthProgression(logs, 'Pull-up', 'kg');
    expect(pullupTrend[0].maxWeight).toBe(110);
    expect(pullupTrend[0].max1RM).toBeCloseTo(146.7, 1);

    const dipTrend = getStrengthProgression(logs, 'Assisted Dip', 'kg');
    expect(dipTrend[0].maxWeight).toBe(90);
    expect(dipTrend[0].max1RM).toBeCloseTo(114.0, 1);

    // 6. Diary Scorecard & Insights
    const scorecards = generateDiaryScorecardMap(logs);
    expect(scorecards['log-unified-mixed-001']).toBeDefined();

    // 7. Achievements Evaluation
    const achievements = evaluateAchievements(logs);
    expect(achievements).toBeDefined();

    // 8. Program Report Cards
    const reportCard = getProgramReportCard(sampleProgram, logs, 'kg');
    expect(reportCard.completedCount).toBe(1);
    expect(reportCard.exerciseStats).toHaveLength(3);

    // 9. Visible Diary Classification Pathway
    const classification = classifyDiaryWorkout(fixtureLog);
    expect(classification).toBeDefined();
    expect(classification.id).toBeDefined();
    expect(classification.label).toBeDefined();

    // Invariance: logs must not be mutated
    const serializedAfter = JSON.stringify(logs);
    expect(serializedAfter).toBe(serializedBefore);
  });

  it('confirms assisted directionality: lower assistance produces higher effective load and e1RM', () => {
    const log20kgAssist: WorkoutLog = {
      id: 'log-ast-20',
      date: '2026-08-10',
      unit: 'kg',
      bodyweightSnapshot: { value: 110, unit: 'kg' },
      exercises: [{
        name: 'Assisted Pull-up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8.0, form: 'standard', isCompleted: true }]
      }]
    };

    const log10kgAssist: WorkoutLog = {
      id: 'log-ast-10',
      date: '2026-08-15',
      unit: 'kg',
      bodyweightSnapshot: { value: 110, unit: 'kg' },
      exercises: [{
        name: 'Assisted Pull-up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 10, reps: 8, rpe: 8.0, form: 'standard', isCompleted: true }]
      }]
    };

    const astLogs = [log20kgAssist, log10kgAssist];
    const prs = getPersonalRecords(astLogs, 'kg');
    // Log with 10kg assistance (100kg effective load) ranks as all-time PR over 20kg assistance (90kg effective load)
    expect(prs[0].date).toBe('2026-08-15');
    expect(prs[0].weight).toBe(100);
    expect(prs[0].est1RM).toBeCloseTo(126.7, 1);
  });

  it('confirms RTS Capacity vs Epley 1RM cross-view inversion invariance', () => {
    // Session A: 100 kg x 10 @ RPE 8 -> RTS capacity = 100 / 0.680 = 147.0588 kg; Epley = 100 * (1 + 10/30) = 133.3333 kg
    // Session B: 105 kg x 10 @ RPE 10 -> RTS capacity = 105 / 0.739 = 142.0838 kg; Epley = 105 * (1 + 10/30) = 140.0000 kg
    const sessionA_RTS = calculateE1RMForSet(100, 10, 8.0);
    const sessionA_Epley = calculateEpley1RM(100, 10);

    const sessionB_RTS = calculateE1RMForSet(105, 10, 10.0);
    const sessionB_Epley = calculateEpley1RM(105, 10);

    expect(sessionA_RTS).toBeCloseTo(147.0588235, 4);
    expect(sessionA_Epley).toBeCloseTo(133.3333333, 4);

    expect(sessionB_RTS).toBeCloseTo(142.0838972, 4);
    expect(sessionB_Epley).toBeCloseTo(140.0000000, 4);

    // Session A has superior RTS capacity, Session B has superior Epley 1RM
    expect(sessionA_RTS!).toBeGreaterThan(sessionB_RTS!);
    expect(sessionB_Epley).toBeGreaterThan(sessionA_Epley);
  });
});
