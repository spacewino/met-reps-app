/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkoutLog, ExerciseEntry, SetEntry, WeightUnit, mapLitersToHydration } from '../types';
import { resolveSetEffectiveLoad } from './effectiveLoad';
import { convertWeightUnit } from './assistedLoadMath';

export interface StrengthProgressionPoint {
  date: string;
  maxWeight: number;
  max1RM: number;
  sleep: number;
  calories: number;
  rpe: number;
}

export interface PlateauStatus {
  status: 'Breaking Through' | 'Strength Plateau' | 'Stable Strength' | 'Insufficient Data';
  desc: string;
  color?: string;
}

export interface RecoveryCorrelationsResult {
  sleepFactor: string;
  calFactor: string;
  sleepCount: number;
  calCount: number;
  sleepDesc: string;
  calDesc: string;
  targetSleep: number | null;
  targetCalories: number | null;
  targetMethod: string;
  isCalculated: boolean;
}

export interface HistoricalPRItem {
  exercise: string;
  weight: number;
  reps: number;
  est1RM: number;
  date: string;
  sleep: number;
  calories: number;
  hydration: string;
  muscleGroup: string;
}

/**
 * Pure Epley calculation from effective load and repetition count.
 * e1RM = reps === 1 ? effectiveLoad : effectiveLoad * (1 + reps / 30)
 */
export function calculateEpley1RM(effectiveLoad: number, reps: number): number {
  if (!Number.isFinite(effectiveLoad) || effectiveLoad <= 0 || !Number.isFinite(reps) || reps <= 0) {
    return 0;
  }
  if (reps === 1) {
    return effectiveLoad;
  }
  return effectiveLoad * (1 + reps / 30);
}

/**
 * Extracts all unique exercises with mass-bearing modalities (weighted, bodyweight, assisted)
 * that have been logged in workout history.
 */
export function getUniqueTrackedExercises(logs: WorkoutLog[]): string[] {
  if (!Array.isArray(logs)) return ['Back Squat (High Bar)'];
  const list = new Set<string>();
  logs.forEach(log => {
    log.exercises?.forEach(ex => {
      if (ex.name && !ex.isSkipped) {
        const modality = ex.modality || 'weighted';
        if (modality === 'weighted' || modality === 'bodyweight' || modality === 'assisted') {
          list.add(ex.name);
        }
      }
    });
  });
  if (list.size === 0) list.add('Back Squat (High Bar)');
  return Array.from(list);
}

/**
 * Computes chronological Strength Progression points for a selected exercise.
 * Canonical effective load resolution is used for weighted, bodyweight (snapshots), and assisted modalities.
 */
export function getStrengthProgression(
  logs: WorkoutLog[],
  exerciseName: string,
  targetUnit: WeightUnit = 'kg'
): StrengthProgressionPoint[] {
  if (!Array.isArray(logs) || !exerciseName) return [];

  const data: StrengthProgressionPoint[] = [];
  const normTarget = exerciseName.trim().toLowerCase();

  // Sort logs chronologically without mutating input array
  const sortedLogs = [...logs].sort((a, b) => {
    const epochA = Date.parse(a.date);
    const epochB = Date.parse(b.date);
    if (!Number.isNaN(epochA) && !Number.isNaN(epochB)) {
      return epochA - epochB;
    }
    return (a.date || '').localeCompare(b.date || '');
  });

  sortedLogs.forEach(log => {
    if (!log || !Array.isArray(log.exercises)) return;

    const ex = log.exercises.find(
      e => !e.isSkipped && e.name && e.name.trim().toLowerCase() === normTarget
    );

    if (ex && Array.isArray(ex.sets) && ex.sets.length > 0) {
      const modality = ex.modality || 'weighted';
      const validSets = ex.sets.filter(
        s =>
          !s.isSkipped &&
          s.isCompleted !== false &&
          !s.isWarmup &&
          typeof s.reps === 'number' &&
          Number.isInteger(s.reps) &&
          s.reps > 0
      );

      if (validSets.length === 0) return;

      const effectiveLoadsInTargetUnit: number[] = [];
      const epley1RMsInTargetUnit: number[] = [];
      const rpes: number[] = [];

      for (const s of validSets) {
        const loadRes = resolveSetEffectiveLoad(
          s.weight,
          modality,
          log.unit,
          log.bodyweightSnapshot
        );

        if (loadRes.status !== 'valid' || loadRes.effectiveLoadKg === null || loadRes.effectiveLoadKg <= 0) {
          continue;
        }

        const effInTarget = targetUnit === 'kg'
          ? loadRes.effectiveLoadKg
          : convertWeightUnit(loadRes.effectiveLoadKg, 'kg', targetUnit);

        const e1rm = calculateEpley1RM(effInTarget, s.reps!);
        effectiveLoadsInTargetUnit.push(effInTarget);
        epley1RMsInTargetUnit.push(e1rm);
        rpes.push(s.rpe || 8);
      }

      if (effectiveLoadsInTargetUnit.length === 0) return;

      const maxWeight = Math.max(...effectiveLoadsInTargetUnit, 0);
      const max1RM = Math.max(...epley1RMsInTargetUnit, 0);
      const avgRpe = rpes.length > 0 ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 8;

      const parsedDate = new Date(log.date);
      const formattedDate = !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : log.date;

      data.push({
        date: formattedDate,
        maxWeight: Math.round(maxWeight * 10) / 10,
        max1RM: Math.round(max1RM * 10) / 10,
        sleep: log.recovery?.sleepHours ?? 7,
        calories: log.recovery?.nutritionCalories ?? 2000,
        rpe: avgRpe,
      });
    }
  });

  return data;
}

/**
 * Downsamples strength history to a max number of data points while preserving local peaks.
 */
export function downsampleStrengthHistory(
  history: StrengthProgressionPoint[],
  maxPoints: number = 10
): StrengthProgressionPoint[] {
  if (!Array.isArray(history) || history.length <= maxPoints) {
    return history || [];
  }
  const bucketSize = history.length / maxPoints;
  const downsampled: StrengthProgressionPoint[] = [];

  for (let i = 0; i < maxPoints; i++) {
    const startIdx = Math.floor(i * bucketSize);
    const endIdx = Math.min(Math.floor((i + 1) * bucketSize), history.length);
    const slice = history.slice(startIdx, endIdx);

    if (slice.length > 0) {
      let bestPoint = slice[0];
      for (let j = 1; j < slice.length; j++) {
        if (slice[j].max1RM > bestPoint.max1RM) {
          bestPoint = slice[j];
        }
      }
      downsampled.push(bestPoint);
    }
  }
  return downsampled;
}

/**
 * Detects whether the recent strength curve indicates a breakthrough, plateau, or stable strength.
 */
export function getPlateauStatus(history: StrengthProgressionPoint[]): PlateauStatus {
  if (!Array.isArray(history) || history.length < 3) {
    return {
      status: 'Insufficient Data',
      desc: 'Log at least 3 sessions of this exercise to analyze trendlines.',
    };
  }
  const lastThree = history.slice(-3);
  const w1 = lastThree[0].max1RM;
  const w2 = lastThree[1].max1RM;
  const w3 = lastThree[2].max1RM;

  if (w3 > w2 && w2 >= w1) {
    return {
      status: 'Breaking Through',
      desc: 'Great job! Your standardised 1RM strength curve is actively ascending week-over-week.',
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    };
  } else if (Math.abs(w3 - w2) < 1 && Math.abs(w2 - w1) < 1) {
    return {
      status: 'Strength Plateau',
      desc: 'Your estimated 1RM is stuck. Try increasing recovery, tweaking food volume, or deloading.',
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    };
  } else {
    return {
      status: 'Stable Strength',
      desc: 'Your lifting weight and 1RM is steady. Focus on form optimization and high intensity.',
      color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    };
  }
}

/**
 * Computes all-time Personal Records across mass-bearing modalities with canonical effective load resolution.
 */
export function getPersonalRecords(
  logs: WorkoutLog[],
  targetUnit: WeightUnit = 'kg'
): HistoricalPRItem[] {
  if (!Array.isArray(logs)) return [];

  const prMap: Record<
    string,
    {
      weight: number;
      reps: number;
      est1RM: number;
      date: string;
      sleep: number;
      calories: number;
      hydration: string;
      muscleGroup: string;
    }
  > = {};

  logs.forEach(log => {
    if (!log || !Array.isArray(log.exercises)) return;

    log.exercises.forEach(ex => {
      if (!ex || ex.isSkipped || !ex.name) return;

      const modality = ex.modality || 'weighted';
      if (modality !== 'weighted' && modality !== 'bodyweight' && modality !== 'assisted') {
        return;
      }

      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      sets.forEach(s => {
        if (!s || s.isSkipped || s.isCompleted === false || s.isWarmup) return;
        const reps = s.reps;
        if (typeof reps !== 'number' || !Number.isInteger(reps) || reps <= 0) return;

        const loadRes = resolveSetEffectiveLoad(
          s.weight,
          modality,
          log.unit,
          log.bodyweightSnapshot
        );

        if (loadRes.status !== 'valid' || loadRes.effectiveLoadKg === null || loadRes.effectiveLoadKg <= 0) {
          return;
        }

        const effInTarget = targetUnit === 'kg'
          ? loadRes.effectiveLoadKg
          : convertWeightUnit(loadRes.effectiveLoadKg, 'kg', targetUnit);

        const est = calculateEpley1RM(effInTarget, reps);
        const roundedEst = Math.round(est * 10) / 10;
        const roundedWeight = Math.round(effInTarget * 10) / 10;

        const existing = prMap[ex.name];
        if (!existing || roundedEst > existing.est1RM) {
          prMap[ex.name] = {
            weight: roundedWeight,
            reps,
            est1RM: roundedEst,
            date: log.date,
            sleep: log.recovery?.sleepHours ?? 7,
            calories: log.recovery?.nutritionCalories ?? 2500,
            hydration:
              log.recovery?.hydrationLevel ||
              (log.recovery?.hydrationLiters
                ? mapLitersToHydration(log.recovery.hydrationLiters)
                : 'Adequate'),
            muscleGroup: ex.muscleGroup || 'Other',
          };
        }
      });
    });
  });

  return Object.entries(prMap)
    .map(([exercise, details]) => ({
      exercise,
      ...details,
    }))
    .sort((a, b) => b.est1RM - a.est1RM);
}

/**
 * Computes Sleep and Calorie recovery correlation factors and PR optimization targets for a selected exercise.
 */
export function getRecoveryCorrelations(
  logs: WorkoutLog[],
  exerciseName: string,
  targetUnit: WeightUnit = 'kg'
): RecoveryCorrelationsResult {
  if (!Array.isArray(logs) || !exerciseName) {
    return {
      sleepFactor: 'Needs 2+ Logs',
      calFactor: 'Needs 2+ Logs',
      sleepCount: 0,
      calCount: 0,
      sleepDesc: `Log at least 2 sessions of ${exerciseName || 'this exercise'} to analyze recovery correlation.`,
      calDesc: `Log at least 2 sessions of ${exerciseName || 'this exercise'} to analyze recovery correlation.`,
      targetSleep: null,
      targetCalories: null,
      targetMethod: 'Log more data',
      isCalculated: false,
    };
  }

  const normTarget = exerciseName.trim().toLowerCase();
  const sessions: Array<{ est1RM: number; sleep: number; calories: number }> = [];

  // Sort logs chronologically to ensure accurate trend-line tracking
  const sortedLogs = [...logs].sort((a, b) => {
    const epochA = Date.parse(a.date);
    const epochB = Date.parse(b.date);
    if (!Number.isNaN(epochA) && !Number.isNaN(epochB)) {
      return epochA - epochB;
    }
    return (a.date || '').localeCompare(b.date || '');
  });

  sortedLogs.forEach(log => {
    if (!log || !Array.isArray(log.exercises)) return;
    const sleep = log.recovery?.sleepHours ?? 7;
    const cals = log.recovery?.nutritionCalories ?? 2500;

    log.exercises.forEach(ex => {
      if (
        !ex.isSkipped &&
        ex.name &&
        ex.name.trim().toLowerCase() === normTarget
      ) {
        const modality = ex.modality || 'weighted';
        if (modality === 'weighted' || modality === 'bodyweight' || modality === 'assisted') {
          const sets = Array.isArray(ex.sets) ? ex.sets : [];
          const validSets = sets.filter(
            s =>
              !s.isSkipped &&
              s.isCompleted !== false &&
              !s.isWarmup &&
              typeof s.reps === 'number' &&
              Number.isInteger(s.reps) &&
              s.reps > 0
          );

          const epley1RMs: number[] = [];
          for (const s of validSets) {
            const loadRes = resolveSetEffectiveLoad(
              s.weight,
              modality,
              log.unit,
              log.bodyweightSnapshot
            );

            if (loadRes.status === 'valid' && loadRes.effectiveLoadKg !== null && loadRes.effectiveLoadKg > 0) {
              const eff = targetUnit === 'kg'
                ? loadRes.effectiveLoadKg
                : convertWeightUnit(loadRes.effectiveLoadKg, 'kg', targetUnit);
              const e1rm = calculateEpley1RM(eff, s.reps!);
              epley1RMs.push(e1rm);
            }
          }

          const max1RM = epley1RMs.length > 0 ? Math.max(...epley1RMs) : 0;
          if (max1RM > 0) {
            sessions.push({ est1RM: max1RM, sleep, calories: cals });
          }
        }
      }
    });
  });

  if (sessions.length < 2) {
    return {
      sleepFactor: 'Needs 2+ Logs',
      calFactor: 'Needs 2+ Logs',
      sleepCount: sessions.length,
      calCount: sessions.length,
      sleepDesc: `Log at least 2 sessions of ${exerciseName} to analyze recovery correlation.`,
      calDesc: `Log at least 2 sessions of ${exerciseName} to analyze recovery correlation.`,
      targetSleep: null,
      targetCalories: null,
      targetMethod: 'Log more data',
      isCalculated: false,
    };
  }

  // 1. SLEEP CORRELATION
  const sleepValues = sessions.map(s => s.sleep);
  const minSleep = Math.min(...sleepValues);
  const maxSleep = Math.max(...sleepValues);

  function avgSleep(arr: number[]) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  let sleepFactorStr = 'Stable (+0.0%)';
  let sleepDesc = `Your sleep duration is steady at ${avgSleep(sleepValues).toFixed(1)} hours across your logged ${exerciseName} sessions.`;

  if (maxSleep > minSleep) {
    const avgSleepThreshold = avgSleep(sleepValues);
    const highSleepGroup = sessions.filter(s => s.sleep >= avgSleepThreshold);
    const lowSleepGroup = sessions.filter(s => s.sleep < avgSleepThreshold);

    if (highSleepGroup.length > 0 && lowSleepGroup.length > 0) {
      const avgHigh1RM = highSleepGroup.reduce((sum, s) => sum + s.est1RM, 0) / highSleepGroup.length;
      const avgLow1RM = lowSleepGroup.reduce((sum, s) => sum + s.est1RM, 0) / lowSleepGroup.length;

      if (avgLow1RM > 0) {
        const diff = ((avgHigh1RM - avgLow1RM) / avgLow1RM) * 100;
        const sign = diff >= 0 ? '+' : '';
        sleepFactorStr = `${sign}${diff.toFixed(1)}%`;
        sleepDesc = `When sleeping above your average of ${avgSleepThreshold.toFixed(1)} hrs, your estimated 1RM tracks ${diff >= 0 ? 'higher' : 'lower'} by average.`;
      }
    }
  } else {
    sleepFactorStr = 'Stable (0.0%)';
    sleepDesc = `Log varying sleep durations (currently all ${minSleep} hrs) to see how it affects your ${exerciseName} performance!`;
  }

  // 2. CALORIE CORRELATION
  const calValues = sessions.map(s => s.calories);
  const minCals = Math.min(...calValues);
  const maxCals = Math.max(...calValues);

  function avgCal(arr: number[]) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  let calFactorStr = 'Stable (+0.0%)';
  let calDesc = `Your calorie intake is steady at ${Math.round(avgCal(calValues))} kcal across your logged ${exerciseName} sessions.`;

  if (maxCals > minCals) {
    const avgCalThreshold = avgCal(calValues);
    const highCalGroup = sessions.filter(s => s.calories >= avgCalThreshold);
    const lowCalGroup = sessions.filter(s => s.calories < avgCalThreshold);

    if (highCalGroup.length > 0 && lowCalGroup.length > 0) {
      const avgHigh1RM = highCalGroup.reduce((sum, s) => sum + s.est1RM, 0) / highCalGroup.length;
      const avgLow1RM = lowCalGroup.reduce((sum, s) => sum + s.est1RM, 0) / lowCalGroup.length;

      if (avgLow1RM > 0) {
        const diff = ((avgHigh1RM - avgLow1RM) / avgLow1RM) * 100;
        const sign = diff >= 0 ? '+' : '';
        calFactorStr = `${sign}${diff.toFixed(1)}%`;
        calDesc = `When eating above your average of ${Math.round(avgCalThreshold)} kcal, your estimated 1RM tracks ${diff >= 0 ? 'higher' : 'lower'} by average.`;
      }
    }
  } else {
    calFactorStr = 'Stable (0.0%)';
    calDesc = `Log varying calories (currently all ${minCals} kcal) to see how it fuels your ${exerciseName} sessions!`;
  }

  // 3. TARGET CALCULATIONS (Strength Optimization Formula)
  const peak1RM = Math.max(...sessions.map(s => s.est1RM));
  let targetSessions: typeof sessions = [];
  let targetMethod = 'Baseline recommendation';
  let isCalculated = false;

  // A: Try to find sessions within 10%, 15%, or 20% of peak 1RM that showed an upward strength trend compared to previous session
  for (const threshold of [0.90, 0.85, 0.80]) {
    const matches: typeof sessions = [];
    for (let i = 1; i < sessions.length; i++) {
      const current = sessions[i];
      const prev = sessions[i - 1];
      if (current.est1RM >= threshold * peak1RM && current.est1RM > prev.est1RM) {
        matches.push(current);
      }
    }
    if (matches.length > 0) {
      targetSessions = matches;
      targetMethod = `Averaged from peak sessions (within ${Math.round((1 - threshold) * 100)}% of 1RM) showing upward trend`;
      isCalculated = true;
      break;
    }
  }

  // B: Fallback to any sessions showing upward strength trend if peak zone is sparse
  if (targetSessions.length === 0) {
    const matches: typeof sessions = [];
    for (let i = 1; i < sessions.length; i++) {
      if (sessions[i].est1RM > sessions[i - 1].est1RM) {
        matches.push(sessions[i]);
      }
    }
    if (matches.length > 0) {
      targetSessions = matches;
      targetMethod = 'Averaged from all sessions showing upward strength trend';
      isCalculated = true;
    }
  }

  // C: Fallback to top 3 peak performance sessions if no upward trend exists
  if (targetSessions.length === 0 && sessions.length >= 1) {
    const sortedBy1RM = [...sessions].sort((a, b) => b.est1RM - a.est1RM);
    targetSessions = sortedBy1RM.slice(0, Math.min(3, sessions.length));
    targetMethod = `Averaged from your top ${targetSessions.length} peak performance sessions`;
    isCalculated = true;
  }

  let targetSleep = 8.0;
  let targetCalories = 2500;

  if (targetSessions.length > 0) {
    const avgSleepVal = targetSessions.reduce((sum, s) => sum + s.sleep, 0) / targetSessions.length;
    const avgCalVal = targetSessions.reduce((sum, s) => sum + s.calories, 0) / targetSessions.length;

    targetSleep = Math.max(7.5, Math.min(9.0, Math.round(avgSleepVal * 10) / 10));
    targetCalories = Math.round(avgCalVal);
  } else {
    const allSleep = sessions.map(s => s.sleep);
    const allCals = sessions.map(s => s.calories);
    if (allSleep.length > 0) {
      const avg = allSleep.reduce((a, b) => a + b, 0) / allSleep.length;
      targetSleep = Math.max(7.5, Math.min(8.5, Math.round((avg + 0.5) * 10) / 10));
    }
    if (allCals.length > 0) {
      const avg = allCals.reduce((a, b) => a + b, 0) / allCals.length;
      targetCalories = Math.round(avg + 200);
    }
  }

  return {
    sleepFactor: sleepFactorStr,
    calFactor: calFactorStr,
    sleepCount: sessions.length,
    calCount: sessions.length,
    sleepDesc,
    calDesc,
    targetSleep,
    targetCalories,
    targetMethod,
    isCalculated,
  };
}
