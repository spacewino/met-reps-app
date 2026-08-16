/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getHistoricalSetDisplayState } from '../historicalDisplay';
import { SetEntry, WorkoutLog } from '../../types';

describe('Historical Diary Set-Level Skipped Indicator Display Helper', () => {
  it('identifies a skipped historical set and flags showSkippedBadge with preserved target values', () => {
    const skippedSet: SetEntry = {
      setNumber: 3,
      weight: 100,
      reps: 8,
      rpe: 8.5,
      isCompleted: false,
      isSkipped: true,
      form: 'strict',
      comment: 'Felt fatigue in shoulder',
    };

    const state = getHistoricalSetDisplayState(skippedSet);

    expect(state.showSkippedBadge).toBe(true);
    expect(state.isSkipped).toBe(true);
    expect(state.isRowMuted).toBe(true);
    // Prescribed target weight, reps, RPE must remain legible and unmutated
    expect(state.weight).toBe(100);
    expect(state.reps).toBe(8);
    expect(state.rpe).toBe(8.5);
    expect(state.form).toBe('strict');
    expect(state.comment).toBe('Felt fatigue in shoulder');
  });

  it('does NOT show skipped badge when isSkipped is false (normal completed set)', () => {
    const completedSet: SetEntry = {
      setNumber: 1,
      weight: 120,
      reps: 6,
      rpe: 9,
      isCompleted: true,
      isSkipped: false,
    };

    const state = getHistoricalSetDisplayState(completedSet);

    expect(state.showSkippedBadge).toBe(false);
    expect(state.isSkipped).toBe(false);
    expect(state.isRowMuted).toBe(false);
    expect(state.weight).toBe(120);
    expect(state.reps).toBe(6);
    expect(state.rpe).toBe(9);
  });

  it('does NOT show skipped badge for legacy sets where isSkipped is undefined', () => {
    const legacySet: SetEntry = {
      setNumber: 2,
      weight: 80,
      reps: 10,
      rpe: 7.5,
      isCompleted: true,
    };

    const state = getHistoricalSetDisplayState(legacySet);

    expect(state.showSkippedBadge).toBe(false);
    expect(state.isSkipped).toBe(false);
    expect(state.isRowMuted).toBe(false);
    expect(state.weight).toBe(80);
    expect(state.reps).toBe(10);
  });

  it('handles multiple sets in a workout where only contiguous suffix sets are skipped', () => {
    const sets: SetEntry[] = [
      { setNumber: 1, weight: 100, reps: 5, rpe: 7, isCompleted: true, isSkipped: false },
      { setNumber: 2, weight: 100, reps: 5, rpe: 8, isCompleted: true, isSkipped: false },
      { setNumber: 3, weight: 100, reps: 5, rpe: 8.5, isCompleted: false, isSkipped: true },
      { setNumber: 4, weight: 100, reps: 5, rpe: 9, isCompleted: false, isSkipped: true },
    ];

    const states = sets.map(s => getHistoricalSetDisplayState(s));

    expect(states[0].showSkippedBadge).toBe(false);
    expect(states[0].isRowMuted).toBe(false);
    expect(states[1].showSkippedBadge).toBe(false);
    expect(states[1].isRowMuted).toBe(false);

    expect(states[2].showSkippedBadge).toBe(true);
    expect(states[2].isRowMuted).toBe(true);
    expect(states[2].weight).toBe(100);
    expect(states[2].reps).toBe(5);

    expect(states[3].showSkippedBadge).toBe(true);
    expect(states[3].isRowMuted).toBe(true);
    expect(states[3].weight).toBe(100);
    expect(states[3].reps).toBe(5);
  });

  it('suppresses redundant set-level skipped badge if parent exercise is already marked skipped', () => {
    const setInSkippedExercise: SetEntry = {
      setNumber: 1,
      weight: 60,
      reps: 12,
      rpe: 8,
      isCompleted: false,
      isSkipped: true,
    };

    // When exercise is skipped, row is muted, but individual set badge is suppressed to avoid redundant badge clutter
    const state = getHistoricalSetDisplayState(setInSkippedExercise, true);

    expect(state.showSkippedBadge).toBe(false);
    expect(state.isSkipped).toBe(true);
    expect(state.isRowMuted).toBe(true);
  });

  it('preserves warmup and drop set flags alongside display state', () => {
    const warmupSet: SetEntry = {
      setNumber: 0,
      weight: 40,
      reps: 10,
      isWarmup: true,
      isCompleted: true,
    };
    const dropSet: SetEntry = {
      setNumber: 3,
      weight: 70,
      reps: 8,
      rpe: 9.5,
      isDropSet: true,
      isCompleted: true,
    };

    const warmupState = getHistoricalSetDisplayState(warmupSet);
    const dropState = getHistoricalSetDisplayState(dropSet);

    expect(warmupState.isWarmup).toBe(true);
    expect(warmupState.isDropSet).toBe(false);
    expect(dropState.isWarmup).toBe(false);
    expect(dropState.isDropSet).toBe(true);
  });

  it('strictly ensures read-only safety: does NOT mutate the original SetEntry or WorkoutLog object', () => {
    const originalSet: SetEntry = Object.freeze({
      setNumber: 2,
      weight: 140,
      reps: 3,
      rpe: 9,
      isCompleted: false,
      isSkipped: true,
      form: 'strict',
    });

    const state = getHistoricalSetDisplayState(originalSet);

    expect(state.showSkippedBadge).toBe(true);
    expect(originalSet.isSkipped).toBe(true);
    expect(originalSet.weight).toBe(140);
    expect(originalSet.reps).toBe(3);
  });

  it('verifies that volume calculations correctly exclude skipped sets while retaining performed sets', () => {
    const mockLog: WorkoutLog = {
      id: 'log-1',
      date: '2026-06-09',
      program: 'Leg Day',
      day: '1',
      unit: 'kg',
      exercises: [
        {
          name: 'Squat',
          muscleGroup: 'Quads',
          sets: [
            { setNumber: 1, weight: 100, reps: 5, isCompleted: true, isSkipped: false },
            { setNumber: 2, weight: 100, reps: 5, isCompleted: true, isSkipped: false },
            { setNumber: 3, weight: 100, reps: 5, isCompleted: false, isSkipped: true }, // skipped target
          ],
        },
      ],
    };

    // Calculate volume excluding skipped sets
    let totalVolumeKg = 0;
    mockLog.exercises.forEach(ex => {
      if (ex.isSkipped) return;
      const validSets = ex.sets.filter(s => !s.isSkipped && s.isCompleted !== false);
      validSets.forEach(s => {
        totalVolumeKg += (s.weight || 0) * (s.reps || 0);
      });
    });

    // 100*5 + 100*5 = 1000 kg (set 3 is excluded)
    expect(totalVolumeKg).toBe(1000);
  });
});
