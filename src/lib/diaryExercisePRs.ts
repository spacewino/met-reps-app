import { WorkoutLog, ExerciseEntry, SetEntry, WeightUnit } from '../types';
import { resolveSetEffectiveLoad } from './effectiveLoad';

export interface ExercisePRResult {
  isPR: boolean;
  est1RM: number | null;
  effectiveLoad: number | null;
  reps: number | null;
  unit: WeightUnit;
}

export type ExercisePRMap = Record<string, boolean>; // key: `${logId}_${exerciseIndex}_${setIndex}` -> isPR

/**
 * Parses an ID timestamp only if it strictly matches exactly 12+ digits or 'log-' followed by 12+ digits.
 */
function parseStrictIdTimestamp(id: string | null | undefined): number | null {
  if (!id) return null;
  const digitsOnlyMatch = id.match(/^\d{12,}$/);
  if (digitsOnlyMatch) {
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }
  const logPrefixedMatch = id.match(/^log-(\d{12,})$/);
  if (logPrefixedMatch) {
    const n = Number(logPrefixedMatch[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Returns true if a date string is a valid ISO/calendar date.
 */
function isValidDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const epoch = Date.parse(dateStr);
  return Number.isFinite(epoch);
}

/**
 * Calculates whether a specific set in a workout log represents an all-time PR
 * considering strictly preceding workout logs in deterministic Diary chronology.
 *
 * Chronology:
 * 1. Valid calendar date.
 * 2. On the same calendar day, strict epoch-like timestamp IDs (^\d{12,}$ or ^log-\d{12,}$).
 * 3. Fallback to original array order for arbitrary same-day IDs.
 * 4. Duplicate IDs are omitted from the resulting PR map to prevent ambiguity.
 * 5. Invalid-date logs are safely isolated from valid chronological history.
 *
 * Uses Epley estimation on canonical effective load:
 * est1RM = effectiveLoadKg * (1 + reps / 30)  (when reps > 1, else effectiveLoadKg)
 */
export function generateExercisePRMap(allLogs: WorkoutLog[]): ExercisePRMap {
  const prMap: ExercisePRMap = {};
  if (!Array.isArray(allLogs) || allLogs.length === 0) {
    return prMap;
  }

  // Detect duplicate log IDs
  const idCounts = new Map<string, number>();
  allLogs.forEach(log => {
    if (log && log.id) {
      idCounts.set(log.id, (idCounts.get(log.id) || 0) + 1);
    }
  });

  interface LogItem {
    log: WorkoutLog;
    originalIndex: number;
    dateEpoch: number | null;
    idTimestamp: number | null;
  }

  const validItems: LogItem[] = [];

  allLogs.forEach((log, originalIndex) => {
    if (!log) return;
    const isDateVal = isValidDate(log.date);
    const idTime = parseStrictIdTimestamp(log.id);

    if (isDateVal || idTime !== null) {
      validItems.push({
        log,
        originalIndex,
        dateEpoch: isDateVal ? Date.parse(log.date) : null,
        idTimestamp: idTime,
      });
    }
  });

  // Sort valid items in exact deterministic chronological order
  validItems.sort((a, b) => {
    const aDateValid = a.dateEpoch !== null;
    const bDateValid = b.dateEpoch !== null;

    if (aDateValid && bDateValid) {
      if (a.dateEpoch !== b.dateEpoch) {
        return a.dateEpoch! - b.dateEpoch!;
      }
      if (a.idTimestamp !== null && b.idTimestamp !== null && a.idTimestamp !== b.idTimestamp) {
        return a.idTimestamp - b.idTimestamp;
      }
      return a.originalIndex - b.originalIndex;
    }

    const aEffectiveTime = a.idTimestamp !== null ? a.idTimestamp : a.dateEpoch!;
    const bEffectiveTime = b.idTimestamp !== null ? b.idTimestamp : b.dateEpoch!;

    if (aEffectiveTime !== bEffectiveTime) {
      return aEffectiveTime - bEffectiveTime;
    }

    return a.originalIndex - b.originalIndex;
  });

  // Track all-time best Epley e1RM in canonical kg per normalized exercise name
  const bestE1RMKgByExercise: Record<string, number> = {};

  for (const { log } of validItems) {
    const isAmbiguous = !log.id || (idCounts.get(log.id) || 0) > 1;
    const exercises = Array.isArray(log.exercises) ? log.exercises : [];

    for (let exIdx = 0; exIdx < exercises.length; exIdx++) {
      const ex = exercises[exIdx];
      if (!ex || ex.isSkipped === true) continue;

      const normName = (ex.name || '').trim().toLowerCase();
      if (!normName) continue;

      const modality = ex.modality || 'weighted';
      const sets = Array.isArray(ex.sets) ? ex.sets : [];

      for (let setIdx = 0; setIdx < sets.length; setIdx++) {
        const s = sets[setIdx];
        if (!s) continue;

        // Skip non-working sets
        if (s.isSkipped === true || s.isWarmup === true || s.isCompleted === false) {
          continue;
        }

        const reps = s.reps;
        if (typeof reps !== 'number' || !Number.isInteger(reps) || reps <= 0) {
          continue;
        }

        const loadRes = resolveSetEffectiveLoad(s.weight, modality, log.unit, log.bodyweightSnapshot);
        if (loadRes.status !== 'valid' || loadRes.effectiveLoadKg === null || loadRes.effectiveLoadKg <= 0) {
          continue;
        }

        const effKg = loadRes.effectiveLoadKg;
        const e1rmKg = reps === 1 ? effKg : effKg * (1 + reps / 30);
        const roundedE1RMKg = Math.round(e1rmKg * 100) / 100;

        const currentBest = bestE1RMKgByExercise[normName];

        let isPR = false;
        if (currentBest === undefined) {
          // First exposure with valid mass load: is a baseline PR
          bestE1RMKgByExercise[normName] = roundedE1RMKg;
          isPR = true;
        } else if (roundedE1RMKg > currentBest + 0.001) {
          // Strictly exceeds previous all-time best
          bestE1RMKgByExercise[normName] = roundedE1RMKg;
          isPR = true;
        }

        if (isPR && !isAmbiguous) {
          prMap[`${log.id}_${exIdx}_${setIdx}`] = true;
        }
      }
    }
  }

  return prMap;
}
